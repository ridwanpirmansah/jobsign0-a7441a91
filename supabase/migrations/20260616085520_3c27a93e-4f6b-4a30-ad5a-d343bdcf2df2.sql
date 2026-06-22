
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_unit text NOT NULL DEFAULT 'day' CHECK (pay_unit IN ('day','hour'));
