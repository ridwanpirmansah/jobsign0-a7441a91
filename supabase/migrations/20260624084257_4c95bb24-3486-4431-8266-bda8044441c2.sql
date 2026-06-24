
-- 1) Fix attendance timezone to Asia/Jakarta (UTC+7)
CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid;
  now_ts timestamptz := now();
  today_date date := (now_ts AT TIME ZONE 'Asia/Jakarta')::date;
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
END $function$;

-- 2) Don't create/sync project for draft orders; clean up project when order returns to draft
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; proj_code text; has_logs boolean;
BEGIN
  -- If order is draft: do not create a project. If a project was linked, detach
  -- and delete it when there are no job_logs referencing it.
  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN
        DELETE FROM public.projects WHERE id = proj_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active')
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- Ensure trigger fires when status changes too
DROP TRIGGER IF EXISTS trg_sync_order_project ON public.orders;
CREATE TRIGGER trg_sync_order_project
AFTER INSERT OR UPDATE OF order_no, text_neon, username, kota, titik, payment, status
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_order_to_project();

-- 3) Clean up existing projects that came from draft orders and have no work logged
DELETE FROM public.projects p
WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.project_id = p.id AND o.status = 'draft')
  AND NOT EXISTS (SELECT 1 FROM public.job_logs jl WHERE jl.project_id = p.id);

UPDATE public.orders SET project_id = NULL
WHERE status = 'draft' AND project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = orders.project_id);
