
ALTER TABLE public.employee_consumption
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cashbon',
  ADD COLUMN IF NOT EXISTS allowance_applied numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_covered numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_id uuid,
  ADD COLUMN IF NOT EXISTS cashbon_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='employee_consumption_payment_method_check') THEN
    ALTER TABLE public.employee_consumption
      ADD CONSTRAINT employee_consumption_payment_method_check CHECK (payment_method IN ('cash','cashbon'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_consumption_expense_id_fkey') THEN
    ALTER TABLE public.employee_consumption
      ADD CONSTRAINT employee_consumption_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_consumption_cashbon_id_fkey') THEN
    ALTER TABLE public.employee_consumption
      ADD CONSTRAINT employee_consumption_cashbon_id_fkey FOREIGN KEY (cashbon_id) REFERENCES public.cashbon(id) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO public.material_prices(key, label, value, unit)
  VALUES ('meal_allowance_per_person', 'Uang Makan Karyawan (per konsumsi)', 5000, 'per konsumsi')
  ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.calc_consumption_split()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE default_allowance numeric;
BEGIN
  IF NEW.allowance_applied IS NULL OR NEW.allowance_applied <= 0 THEN
    SELECT value INTO default_allowance FROM public.material_prices WHERE key='meal_allowance_per_person';
    NEW.allowance_applied := COALESCE(default_allowance, 0);
  END IF;
  NEW.company_covered := LEAST(NEW.amount, NEW.allowance_applied);
  IF NEW.payment_method = 'cash' THEN
    NEW.employee_charge := 0;
  ELSE
    NEW.employee_charge := GREATEST(NEW.amount - NEW.allowance_applied, 0);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_consumption_split ON public.employee_consumption;
CREATE TRIGGER trg_consumption_split
  BEFORE INSERT OR UPDATE OF amount, payment_method, allowance_applied ON public.employee_consumption
  FOR EACH ROW EXECUTE FUNCTION public.calc_consumption_split();

-- Backfill existing rows: treat as cashbon with 0 allowance so full amount stays as employee_charge
UPDATE public.employee_consumption
  SET amount = amount
  WHERE company_covered = 0 AND employee_charge = 0;
