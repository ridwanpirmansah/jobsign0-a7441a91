
CREATE TABLE IF NOT EXISTS public.restore_constraint_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  constraint_name text NOT NULL,
  definition text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.restore_constraint_backup TO service_role;
ALTER TABLE public.restore_constraint_backup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can read restore constraint backup" ON public.restore_constraint_backup
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'owner'));

-- generic export
CREATE OR REPLACE FUNCTION public.backup_export(_schema text, _table text, _offset int DEFAULT 0, _limit int DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE result jsonb;
BEGIN
  IF _schema NOT IN ('public','auth') THEN RAISE EXCEPTION 'schema tidak diizinkan'; END IF;
  IF _schema = 'auth' AND _table NOT IN ('users','identities') THEN RAISE EXCEPTION 'tabel auth tidak diizinkan'; END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (SELECT * FROM %I.%I ORDER BY ctid OFFSET %s LIMIT %s) t',
    _schema, _table, _offset::text, _limit::text) INTO result;
  RETURN result;
END $fn$;

-- generic upsert that ignores unknown / generated columns
CREATE OR REPLACE FUNCTION public.restore_bulk(_schema text, _table text, _rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _rel regclass;
  _cols text;
  _pk text;
  _set text;
  _conflict text;
  _n int;
BEGIN
  IF _schema NOT IN ('public','auth') THEN RAISE EXCEPTION 'schema tidak diizinkan'; END IF;
  IF _schema = 'auth' AND _table NOT IN ('users','identities') THEN RAISE EXCEPTION 'tabel auth tidak diizinkan'; END IF;
  IF _rows IS NULL OR jsonb_array_length(_rows) = 0 THEN RETURN 0; END IF;
  _rel := format('%I.%I', _schema, _table)::regclass;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _cols
  FROM pg_attribute a
  WHERE a.attrelid = _rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND EXISTS (SELECT 1 FROM jsonb_object_keys(_rows->0) k WHERE k = a.attname);
  IF _cols IS NULL THEN RETURN 0; END IF;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _pk
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = _rel AND c.contype = 'p';

  IF _pk IS NULL THEN
    _conflict := 'ON CONFLICT DO NOTHING';
  ELSE
    SELECT string_agg(format('%1$s = excluded.%1$s', quote_ident(a.attname)), ', ' ORDER BY a.attnum) INTO _set
    FROM pg_attribute a
    WHERE a.attrelid = _rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      AND EXISTS (SELECT 1 FROM jsonb_object_keys(_rows->0) k WHERE k = a.attname)
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = _rel AND c.contype = 'p' AND a.attnum = ANY (c.conkey)
      );
    IF _set IS NULL THEN
      _conflict := format('ON CONFLICT (%s) DO NOTHING', _pk);
    ELSE
      _conflict := format('ON CONFLICT (%s) DO UPDATE SET %s', _pk, _set);
    END IF;
  END IF;

  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(null::%s, $1) %s',
    _rel::text, _cols, _cols, _rel::text, _conflict) USING _rows;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $fn$;

-- enter restore mode: drop FKs (saved) + disable user triggers on public tables
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
    WHERE c.contype = 'f' AND n.nspname = 'public'
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

-- leave restore mode: re-enable triggers and restore FKs (NOT VALID so legacy gaps don't block)
CREATE OR REPLACE FUNCTION public.restore_finish()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r record; _ok int := 0; _fail text[] := '{}';
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
  DELETE FROM public.restore_constraint_backup;
  RETURN jsonb_build_object('restored', _ok, 'failed', to_jsonb(_fail));
END $fn$;

REVOKE ALL ON FUNCTION public.backup_export(text, text, int, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_bulk(text, text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_begin() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_finish() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_export(text, text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_bulk(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_begin() TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_finish() TO service_role;
