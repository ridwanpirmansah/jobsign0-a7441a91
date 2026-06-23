
-- 1) orders: add status & adaptor_type
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS adaptor_type text;
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_status_chk CHECK (status IN ('active','return','draft'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

-- 2) material_prices: adaptor variants + marketplace markup percentage
INSERT INTO public.material_prices(key,label,value,unit) VALUES
  ('adaptor_2a','Adaptor 2A (≤3m LED)',8000,'per pcs'),
  ('adaptor_3a','Adaptor 3A (≤5m LED)',15000,'per pcs'),
  ('adaptor_3a_murni','Adaptor 3A Murni (≤8m LED)',30000,'per pcs'),
  ('adaptor_5a_murni','Adaptor 5A Murni (≤11m LED)',40000,'per pcs'),
  ('marketplace_markup_pct','Markup Harga Marketplace',22,'persen')
ON CONFLICT (key) DO NOTHING;

-- 3) Fix get_available_projects: remaining = total - MAX(claimed per rate)
CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.code, p.title, p.status, p.total_points,
    COALESCE((
      SELECT MAX(s.claimed) FROM (
        SELECT SUM(jl.qty) AS claimed
        FROM public.job_logs jl
        WHERE jl.project_id = p.id AND jl.status <> 'rejected'
        GROUP BY jl.rate_id
      ) s
    ), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((
      SELECT MAX(s.claimed) FROM (
        SELECT SUM(jl.qty) AS claimed
        FROM public.job_logs jl
        WHERE jl.project_id = p.id AND jl.status <> 'rejected'
        GROUP BY jl.rate_id
      ) s
    ), 0), 0) AS remaining_points
  FROM public.projects p
  WHERE p.status IN ('draft','active')
  ORDER BY p.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

-- 4) QR Absensi: rotate every 10 seconds
CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid; today_date date := current_date; now_ts timestamptz := now();
  existing_id uuid; existing_in timestamptz; existing_out timestamptz; action text;
  mins_since_in numeric;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 10)::bigint;
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;
  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;
  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir') RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    mins_since_in := EXTRACT(EPOCH FROM (now_ts - existing_in)) / 60.0;
    IF mins_since_in < 60 THEN
      RAISE EXCEPTION 'Check-out minimal 1 jam setelah check-in. Sisa waktu: % menit', CEIL(60 - mins_since_in);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;
  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $$;
REVOKE EXECUTE ON FUNCTION public.attendance_check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text) TO authenticated;

-- 5) Allow karyawan to update note on their own attendance
CREATE OR REPLACE FUNCTION public.set_attendance_note(_attendance_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owns boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.attendances a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = _attendance_id AND (e.profile_id = auth.uid() OR public.is_admin_or_owner(auth.uid()))
  ) INTO owns;
  IF NOT owns THEN RAISE EXCEPTION 'Tidak diizinkan mengubah catatan absensi ini'; END IF;
  UPDATE public.attendances SET note = _note, updated_at = now() WHERE id = _attendance_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_attendance_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_note(uuid, text) TO authenticated;
