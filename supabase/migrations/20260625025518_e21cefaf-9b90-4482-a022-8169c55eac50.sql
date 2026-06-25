
ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS break_start timestamptz,
  ADD COLUMN IF NOT EXISTS break_end timestamptz;

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
  rec record;
  action text;
  mins_since_last numeric;
  last_ts timestamptz;
  min_gap_min numeric := 10;
  daily_date text; daily_sig text; daily_expected text;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;

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

  SELECT * INTO rec FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF rec.id IS NULL THEN
    -- Scan ke-1: Check-In
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING * INTO rec;
    action := 'check_in';
  ELSIF rec.check_out IS NULL AND rec.break_start IS NULL THEN
    -- Scan ke-2: Check-Out (sementara)
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_in)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out';
  ELSIF rec.check_out IS NOT NULL AND rec.break_start IS NULL THEN
    -- Scan ke-3: scan-2 jadi break_start, scan-3 jadi break_end (lanjut kerja)
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_out)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances
      SET break_start = rec.check_out,
          break_end   = now_ts,
          check_out   = NULL
      WHERE id = rec.id;
    action := 'break_end';
  ELSIF rec.break_end IS NOT NULL AND rec.check_out IS NULL THEN
    -- Scan ke-4: Check-Out final
    last_ts := COALESCE(rec.break_end, rec.check_in);
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - last_ts)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out_final';
  ELSE
    RAISE EXCEPTION 'Anda sudah menyelesaikan absensi hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', rec.id, 'time', now_ts);
END $function$;
