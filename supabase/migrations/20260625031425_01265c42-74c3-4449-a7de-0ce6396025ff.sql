
-- 1) Fix user_roles RLS: allow owner to manage ANY role including 'owner'
DROP POLICY IF EXISTS "owner manage non-owner roles" ON public.user_roles;
CREATE POLICY "owner manage all roles" ON public.user_roles
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

-- 2) Cashbon table
CREATE TYPE public.cashbon_status AS ENUM ('pending','approved','rejected','paid');

CREATE TABLE public.cashbon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  note text,
  status public.cashbon_status NOT NULL DEFAULT 'pending',
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashbon TO authenticated;
GRANT ALL ON public.cashbon TO service_role;

ALTER TABLE public.cashbon ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashbon read own or staff" ON public.cashbon FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.employees e WHERE e.id = cashbon.employee_id AND e.profile_id = auth.uid())
    OR public.is_admin_or_owner(auth.uid())
  );

CREATE POLICY "karyawan request own cashbon" ON public.cashbon FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = cashbon.employee_id AND e.profile_id = auth.uid())
  );

CREATE POLICY "karyawan delete own pending cashbon" ON public.cashbon FOR DELETE TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = cashbon.employee_id AND e.profile_id = auth.uid())
  );

CREATE POLICY "staff manage cashbon" ON public.cashbon FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid()))
  WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER trg_cashbon_updated BEFORE UPDATE ON public.cashbon
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
