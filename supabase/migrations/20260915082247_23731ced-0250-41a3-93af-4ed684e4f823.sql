CREATE OR REPLACE FUNCTION public.restore_truncate(_table text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  EXECUTE format('TRUNCATE TABLE public.%I CASCADE', _table);
END $fn$;
REVOKE ALL ON FUNCTION public.restore_truncate(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_truncate(text) TO service_role;