DROP POLICY IF EXISTS "att insert own" ON public.attendances;
DROP POLICY IF EXISTS "att update own today" ON public.attendances;
-- Read-own and admin-manage policies remain. All check-in/out writes must now go through
-- public.attendance_check_in(_token) which validates the rotating QR token.