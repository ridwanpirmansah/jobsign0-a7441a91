
CREATE TYPE public.expense_category AS ENUM ('iklan','bahan_pokok','bahan_penunjang','operasional','gaji','utilitas','transportasi','lainnya');

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  category public.expense_category NOT NULL DEFAULT 'lainnya',
  amount numeric NOT NULL CHECK (amount >= 0),
  description text NOT NULL,
  vendor text,
  note text,
  affects_pnl boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expenses_date_idx ON public.expenses(expense_date DESC);
CREATE INDEX expenses_category_idx ON public.expenses(category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/owner can view expenses" ON public.expenses
  FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "Admin/owner can insert expenses" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "Admin/owner can update expenses" ON public.expenses
  FOR UPDATE TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "Admin/owner can delete expenses" ON public.expenses
  FOR DELETE TO authenticated USING (public.is_admin_or_owner(auth.uid()));

-- Auto set affects_pnl based on category (bahan_pokok = false), but allow override on update by user
CREATE OR REPLACE FUNCTION public.set_expense_defaults()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.category = 'bahan_pokok' THEN
      NEW.affects_pnl := false;
    END IF;
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_expenses_defaults
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_expense_defaults();
