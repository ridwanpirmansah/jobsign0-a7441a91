
-- helper role checkers: only authenticated callers (used by RLS)
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid)                  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid)                  TO authenticated, service_role;

-- trigger-only functions: nobody calls these directly
REVOKE ALL ON FUNCTION public.handle_new_user()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_default_stages()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
