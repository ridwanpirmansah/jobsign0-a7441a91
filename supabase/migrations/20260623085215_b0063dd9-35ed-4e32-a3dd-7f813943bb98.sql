CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.rotate_attendance_secret()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE s text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Forbidden: hanya owner'; END IF;
  UPDATE public.attendance_settings
    SET secret = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
    WHERE id = 1 RETURNING secret INTO s;
  IF s IS NULL THEN
    INSERT INTO public.attendance_settings(id, secret)
      VALUES (1, encode(extensions.gen_random_bytes(32), 'hex'))
      RETURNING secret INTO s;
  END IF;
  RETURN s;
END $function$;