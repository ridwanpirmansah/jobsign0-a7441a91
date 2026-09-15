
CREATE OR REPLACE FUNCTION public.restore_begin()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r record; _n int := 0;
BEGIN
  DELETE FROM public.restore_constraint_backup;
  FOR r IN
    SELECT t.relname AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype IN ('f','c') AND n.nspname = 'public'
      AND t.relname <> 'restore_constraint_backup'
  LOOP
    INSERT INTO public.restore_constraint_backup(table_name, constraint_name, definition)
    VALUES (r.tbl, r.conname, r.def);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname);
    _n := _n + 1;
  END LOOP;

  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', r.tablename);
  END LOOP;
  RETURN _n;
END $fn$;
REVOKE ALL ON FUNCTION public.restore_begin() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_begin() TO service_role;
