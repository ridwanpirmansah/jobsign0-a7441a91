
-- ==========================================
-- ENUMS
-- ==========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'operator', 'karyawan');
CREATE TYPE public.employee_type AS ENUM ('borongan', 'harian');
CREATE TYPE public.employee_status AS ENUM ('active', 'inactive');
CREATE TYPE public.order_status AS ENUM ('draft', 'production', 'qc', 'done', 'delivered', 'cancelled');
CREATE TYPE public.stage_name AS ENUM ('design', 'production', 'qc', 'done');
CREATE TYPE public.stage_status AS ENUM ('pending', 'in_progress', 'done');
CREATE TYPE public.attendance_status AS ENUM ('hadir', 'izin', 'sakit', 'alpha', 'libur');
CREATE TYPE public.payroll_status AS ENUM ('draft', 'approved', 'paid');
CREATE TYPE public.rate_unit AS ENUM ('huruf', 'meter', 'titik', 'pcs', 'unit');

-- ==========================================
-- UTIL: updated_at trigger
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ==========================================
-- profiles
-- ==========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- user_roles
-- ==========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- security-definer role checker
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','supervisor','operator')
  )
$$;

-- ==========================================
-- employees
-- ==========================================
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  type public.employee_type NOT NULL,
  daily_wage NUMERIC(12,2),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  join_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status public.employee_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- customers
-- ==========================================
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  company TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- orders
-- ==========================================
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  width_cm NUMERIC(8,2),
  height_cm NUMERIC(8,2),
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  down_payment NUMERIC(14,2) NOT NULL DEFAULT 0,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  deadline DATE,
  status public.order_status NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_status ON public.orders(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- production_stages
-- ==========================================
CREATE TABLE public.production_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage public.stage_name NOT NULL,
  stage_order INT NOT NULL,
  assigned_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status public.stage_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, stage)
);
CREATE INDEX idx_stages_order ON public.production_stages(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_stages TO authenticated;
GRANT ALL ON public.production_stages TO service_role;
ALTER TABLE public.production_stages ENABLE ROW LEVEL SECURITY;

-- auto-create 4 stages on new order
CREATE OR REPLACE FUNCTION public.create_default_stages()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.production_stages (order_id, stage, stage_order) VALUES
    (NEW.id, 'design',     1),
    (NEW.id, 'production', 2),
    (NEW.id, 'qc',         3),
    (NEW.id, 'done',       4);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_orders_create_stages
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_default_stages();

-- ==========================================
-- job_rates
-- ==========================================
CREATE TABLE public.job_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit public.rate_unit NOT NULL DEFAULT 'pcs',
  rate NUMERIC(12,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_rates TO authenticated;
GRANT ALL ON public.job_rates TO service_role;
ALTER TABLE public.job_rates ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- job_logs
-- ==========================================
CREATE TABLE public.job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  job_rate_id UUID NOT NULL REFERENCES public.job_rates(id),
  work_date DATE NOT NULL,
  qty NUMERIC(10,2) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  notes TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_joblogs_employee_date ON public.job_logs(employee_id, work_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_logs TO authenticated;
GRANT ALL ON public.job_logs TO service_role;
ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- attendances
-- ==========================================
CREATE TABLE public.attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  status public.attendance_status NOT NULL DEFAULT 'hadir',
  overtime_hours NUMERIC(4,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendances TO authenticated;
GRANT ALL ON public.attendances TO service_role;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- payrolls
-- ==========================================
CREATE TABLE public.payrolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  type public.employee_type NOT NULL,
  base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  overtime_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  bonus NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period_start, period_end)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payrolls TO authenticated;
GRANT ALL ON public.payrolls TO service_role;
ALTER TABLE public.payrolls ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- updated_at triggers
-- ==========================================
CREATE TRIGGER trg_profiles_upd          BEFORE UPDATE ON public.profiles          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_employees_upd         BEFORE UPDATE ON public.employees         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_customers_upd         BEFORE UPDATE ON public.customers         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_orders_upd            BEFORE UPDATE ON public.orders            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_stages_upd            BEFORE UPDATE ON public.production_stages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_rates_upd             BEFORE UPDATE ON public.job_rates         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_joblogs_upd           BEFORE UPDATE ON public.job_logs          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_attendances_upd       BEFORE UPDATE ON public.attendances       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_payrolls_upd          BEFORE UPDATE ON public.payrolls          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- Auto-create profile on signup + bootstrap first admin
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- first user becomes admin automatically
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- RLS POLICIES
-- ==========================================

-- profiles
CREATE POLICY "users view own profile" ON public.profiles FOR SELECT USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "admin manage profiles" ON public.profiles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- user_roles (read only by self + staff; mutation by admin only)
CREATE POLICY "view own roles" ON public.user_roles FOR SELECT USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- employees
CREATE POLICY "staff view employees" ON public.employees FOR SELECT USING (public.is_staff(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "admin manage employees" ON public.employees FOR ALL USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor'));

-- customers (staff only)
CREATE POLICY "staff view customers" ON public.customers FOR SELECT USING (public.is_staff(auth.uid()));
CREATE POLICY "staff manage customers" ON public.customers FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- orders (staff only)
CREATE POLICY "staff view orders" ON public.orders FOR SELECT USING (public.is_staff(auth.uid()));
CREATE POLICY "staff manage orders" ON public.orders FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- production_stages
CREATE POLICY "staff view stages" ON public.production_stages FOR SELECT USING (public.is_staff(auth.uid()) OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = assigned_employee_id AND e.user_id = auth.uid()));
CREATE POLICY "staff manage stages" ON public.production_stages FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- job_rates
CREATE POLICY "all view rates" ON public.job_rates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin manage rates" ON public.job_rates FOR ALL USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor'));

-- job_logs (karyawan can insert own draft, view own; staff manage all)
CREATE POLICY "view own joblogs" ON public.job_logs FOR SELECT USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = auth.uid())
);
CREATE POLICY "karyawan insert own joblog" ON public.job_logs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = auth.uid())
  OR public.is_staff(auth.uid())
);
CREATE POLICY "staff manage joblogs" ON public.job_logs FOR UPDATE USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff delete joblogs" ON public.job_logs FOR DELETE USING (public.is_staff(auth.uid()));

-- attendances
CREATE POLICY "view own attendance" ON public.attendances FOR SELECT USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = auth.uid())
);
CREATE POLICY "karyawan checkin own" ON public.attendances FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = auth.uid() AND date = CURRENT_DATE)
  OR public.is_staff(auth.uid())
);
CREATE POLICY "karyawan update own today" ON public.attendances FOR UPDATE USING (
  (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = auth.uid()) AND date = CURRENT_DATE)
  OR public.is_staff(auth.uid())
);
CREATE POLICY "staff delete attendance" ON public.attendances FOR DELETE USING (public.is_staff(auth.uid()));

-- payrolls
CREATE POLICY "view own payroll" ON public.payrolls FOR SELECT USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.user_id = auth.uid())
);
CREATE POLICY "staff manage payroll" ON public.payrolls FOR ALL USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'supervisor'));
