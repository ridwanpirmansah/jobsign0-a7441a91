
-- 1. Revoke EXECUTE from PUBLIC/anon/authenticated on SECURITY DEFINER functions
-- Keep authenticated EXECUTE only for functions intentionally callable by signed-in users.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calc_job_log_amount() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_project_point_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calc_order_costs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_order_to_project() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_attendance_secret() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rotate_attendance_secret() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.attendance_check_in(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_owner(uuid) FROM PUBLIC, anon;

-- has_role / is_admin_or_owner are used inside RLS policies; authenticated needs to call them.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) TO authenticated;

-- 2. Rename misleading customers policy
ALTER POLICY "staff read customers" ON public.customers RENAME TO "admin or owner read customers";

-- 3. Restrict owner role from being assigned/modified/deleted via RLS
DROP POLICY IF EXISTS "owner manage roles" ON public.user_roles;

CREATE POLICY "owner manage non-owner roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (
    has_role(auth.uid(), 'owner'::app_role)
    AND role <> 'owner'::app_role
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role)
    AND role <> 'owner'::app_role
  );
