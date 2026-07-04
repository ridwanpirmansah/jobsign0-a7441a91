
ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS workshop_lat double precision,
  ADD COLUMN IF NOT EXISTS workshop_lng double precision,
  ADD COLUMN IF NOT EXISTS radius_meters integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS enforce_location boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "authenticated read attendance settings meta" ON public.attendance_settings;
CREATE POLICY "authenticated read attendance settings meta"
  ON public.attendance_settings FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.attendance_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.get_permanent_attendance_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE s text; sig text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'Secret belum diinisialisasi'; END IF;
  sig := substr(encode(extensions.hmac('PERMANENT', s, 'sha256'), 'hex'), 1, 24);
  RETURN 'PRM:' || sig;
END $$;

CREATE OR REPLACE FUNCTION public.update_attendance_location(
  _lat double precision,
  _lng double precision,
  _radius integer,
  _enforce boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _radius IS NULL OR _radius < 10 THEN RAISE EXCEPTION 'Radius minimal 10 meter'; END IF;
  UPDATE public.attendance_settings
     SET workshop_lat = _lat,
         workshop_lng = _lng,
         radius_meters = _radius,
         enforce_location = COALESCE(_enforce, false),
         updated_at = now()
   WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO public.attendance_settings(id, workshop_lat, workshop_lng, radius_meters, enforce_location)
      VALUES (1, _lat, _lng, _radius, COALESCE(_enforce, false));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.attendance_check_in(text);
DROP FUNCTION IF EXISTS public.attendance_check_in(text, double precision, double precision);

CREATE OR REPLACE FUNCTION public.attendance_check_in(
  _token text,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
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
  perm_sig text; perm_expected text;
  ws_lat double precision; ws_lng double precision; ws_radius integer; ws_enforce boolean;
  d_meters double precision;
  rad_lat1 double precision; rad_lat2 double precision; rad_dlat double precision; rad_dlng double precision;
  a_h double precision;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret, workshop_lat, workshop_lng, radius_meters, enforce_location
    INTO s, ws_lat, ws_lng, ws_radius, ws_enforce
    FROM public.attendance_settings WHERE id = 1;

  IF COALESCE(ws_enforce, false) THEN
    IF ws_lat IS NULL OR ws_lng IS NULL THEN
      RAISE EXCEPTION 'Lokasi workshop belum diatur oleh admin';
    END IF;
    IF _lat IS NULL OR _lng IS NULL THEN
      RAISE EXCEPTION 'Izinkan akses lokasi pada perangkat Anda untuk melakukan absensi';
    END IF;
    rad_lat1 := radians(ws_lat);
    rad_lat2 := radians(_lat);
    rad_dlat := radians(_lat - ws_lat);
    rad_dlng := radians(_lng - ws_lng);
    a_h := sin(rad_dlat/2)^2 + cos(rad_lat1) * cos(rad_lat2) * sin(rad_dlng/2)^2;
    d_meters := 6371000 * 2 * atan2(sqrt(a_h), sqrt(1 - a_h));
    IF d_meters > ws_radius THEN
      RAISE EXCEPTION 'Anda berada % meter dari workshop (maks % meter). Silakan mendekat ke lokasi.', round(d_meters)::int, ws_radius;
    END IF;
  END IF;

  IF _token LIKE 'PRM:%' THEN
    perm_sig := split_part(_token, ':', 2);
    perm_expected := substr(encode(extensions.hmac('PERMANENT', s, 'sha256'), 'hex'), 1, 24);
    IF perm_sig IS NOT NULL AND perm_sig = perm_expected THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR permanen tidak valid';
    END IF;
  ELSIF _token LIKE 'DLY:%' THEN
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
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING * INTO rec;
    action := 'check_in';
  ELSIF rec.check_out IS NULL AND rec.break_start IS NULL THEN
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_in)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out';
  ELSIF rec.check_out IS NOT NULL AND rec.break_start IS NULL THEN
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
END $$;
