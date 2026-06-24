
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
  daily_date text;
  daily_sig text;
  daily_expected text;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;

  -- Daily backup token format: DLY:YYYYMMDD:<16 hex>
  IF _token LIKE 'DLY:%' THEN
    daily_date := split_part(_token, ':', 2);
    daily_sig  := split_part(_token, ':', 3);
    IF daily_date IS NULL OR length(daily_date) <> 8 OR daily_sig IS NULL OR length(daily_sig) <> 16 THEN
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
    IF daily_date <> to_char(today_date, 'YYYYMMDD') THEN
      RAISE EXCEPTION 'QR harian sudah kadaluarsa (hanya berlaku untuk tanggal %)', daily_date;
    END IF;
    daily_expected := substr(encode(extensions.hmac('DAILY:' || daily_date, s, 'sha256'), 'hex'), 1, 16);
    IF daily_expected = daily_sig THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
  ELSE
    win := floor(extract(epoch FROM now_ts) / 10)::bigint;
    FOR w IN win-1..win+1 LOOP
      expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
      IF expected = _token THEN is_valid := true; EXIT; END IF;
    END LOOP;
    IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION public.get_daily_attendance_token(_date date DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE s text; d date; ymd text; sig text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  d := COALESCE(_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'Secret belum diinisialisasi'; END IF;
  ymd := to_char(d, 'YYYYMMDD');
  sig := substr(encode(extensions.hmac('DAILY:' || ymd, s, 'sha256'), 'hex'), 1, 16);
  RETURN 'DLY:' || ymd || ':' || sig;
END $function$;
