CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  mins_since_in numeric;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN
    RAISE EXCEPTION 'Token tidak valid';
  END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 6)::bigint;
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