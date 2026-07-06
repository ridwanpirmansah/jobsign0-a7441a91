
CREATE TABLE public.employee_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  consumption_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  deducted boolean NOT NULL DEFAULT false,
  payroll_id uuid REFERENCES public.payrolls(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_consumption_employee_date ON public.employee_consumption(employee_id, consumption_date);
CREATE INDEX idx_employee_consumption_deducted ON public.employee_consumption(deducted) WHERE deducted = false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_consumption TO authenticated;
GRANT ALL ON public.employee_consumption TO service_role;

ALTER TABLE public.employee_consumption ENABLE ROW LEVEL SECURITY;

-- Admin/owner: full manage
CREATE POLICY "Admin/owner kelola konsumsi" ON public.employee_consumption
  FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid()))
  WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- Karyawan: hanya lihat konsumsi miliknya sendiri
CREATE POLICY "Karyawan lihat konsumsi sendiri" ON public.employee_consumption
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_consumption.employee_id
        AND e.profile_id = auth.uid()
    )
  );

CREATE TRIGGER update_employee_consumption_updated_at
  BEFORE UPDATE ON public.employee_consumption
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Kolom potongan konsumsi di payrolls
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS consumption_deduction numeric NOT NULL DEFAULT 0;
