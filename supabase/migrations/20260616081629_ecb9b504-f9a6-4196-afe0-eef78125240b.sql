
-- 1. Allow karyawan to delete their own pending logs
CREATE POLICY "karyawan delete own pending" ON public.job_logs
FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = job_logs.employee_id AND e.profile_id = auth.uid())
  AND status = 'pending'
);

-- 2. Attendance secret table (single row)
CREATE TABLE public.attendance_settings (
  id int PRIMARY KEY DEFAULT 1,
  secret text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO public.attendance_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT ON public.attendance_settings TO authenticated;
GRANT ALL ON public.attendance_settings TO service_role;
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;
-- No policies: only accessible via SECURITY DEFINER functions

-- 3. Function: owner/admin reads the secret (used client-side to render rotating QR)
CREATE OR REPLACE FUNCTION public.get_attendance_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  RETURN s;
END $$;

-- 4. Function: rotate secret (owner only)
CREATE OR REPLACE FUNCTION public.rotate_attendance_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Forbidden: hanya owner';
  END IF;
  UPDATE public.attendance_settings
    SET secret = encode(gen_random_bytes(32), 'hex'), updated_at = now()
    WHERE id = 1
    RETURNING secret INTO s;
  RETURN s;
END $$;

-- 5. Function: employee scans QR -> verifies token and records attendance
CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  s text;
  win bigint;
  w bigint;
  expected text;
  is_valid boolean := false;
  emp_id uuid;
  today_date date := current_date;
  now_ts timestamptz := now();
  existing_id uuid;
  existing_in timestamptz;
  existing_out timestamptz;
  action text;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN
    RAISE EXCEPTION 'Token tidak valid';
  END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 6)::bigint;
  -- accept current window and one before (tolerance ~6s)
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN
    RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang';
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN
    RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif';
  END IF;

  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $$;

GRANT EXECUTE ON FUNCTION public.get_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text) TO authenticated;
