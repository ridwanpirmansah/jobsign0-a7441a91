CREATE OR REPLACE FUNCTION public.restore_fix_auth_users()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _n int := 0;
BEGIN
  UPDATE auth.users SET
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    reauthentication_token = COALESCE(reauthentication_token, '')
  WHERE confirmation_token IS NULL OR recovery_token IS NULL OR email_change_token_new IS NULL
     OR email_change IS NULL OR email_change_token_current IS NULL OR phone_change IS NULL
     OR phone_change_token IS NULL OR reauthentication_token IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $fn$;
REVOKE ALL ON FUNCTION public.restore_fix_auth_users() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_fix_auth_users() TO service_role;

CREATE OR REPLACE FUNCTION public.restore_finish()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r record; _ok int := 0; _fail text[] := '{}'; _fixed int := 0;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', r.tablename);
  END LOOP;

  FOR r IN SELECT * FROM public.restore_constraint_backup LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s NOT VALID', r.table_name, r.constraint_name, r.definition);
      _ok := _ok + 1;
    EXCEPTION WHEN duplicate_object THEN
      _ok := _ok + 1;
    WHEN OTHERS THEN
      _fail := _fail || format('%s.%s: %s', r.table_name, r.constraint_name, SQLERRM);
    END;
  END LOOP;
  TRUNCATE TABLE public.restore_constraint_backup;
  SELECT public.restore_fix_auth_users() INTO _fixed;
  RETURN jsonb_build_object('restored', _ok, 'failed', to_jsonb(_fail), 'auth_fixed', _fixed);
END $fn$;
REVOKE ALL ON FUNCTION public.restore_finish() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_finish() TO service_role;