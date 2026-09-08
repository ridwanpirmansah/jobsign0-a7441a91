-- ============================================================
-- GABUNGAN SELURUH MIGRASI (urut tanggal)
-- Salin seluruh isi berkas ini ke SQL Editor Supabase, lalu Run sekali.
-- Dibuat otomatis dari folder supabase/migrations/ (jangan diedit manual).
--
-- CATATAN: bagian penjadwal otomatis (pg_cron) sengaja dinonaktifkan di
-- berkas ini karena menunjuk alamat Lovable. Di Vercel, gunakan Vercel Cron
-- sebagai gantinya (lihat DEPLOY.md bagian Integrasi Shopee).
-- ============================================================


-- ------------------------------------------------------------
-- FILE: 20260616062104_6a3a74d0-9060-4e1b-a5b1-c412c82f2f53.sql
-- ------------------------------------------------------------


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


-- ------------------------------------------------------------
-- FILE: 20260616062132_12835de2-7624-470b-ae34-7dde253bfdf1.sql
-- ------------------------------------------------------------


-- helper role checkers: only authenticated callers (used by RLS)
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid)                  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid)                  TO authenticated, service_role;

-- trigger-only functions: nobody calls these directly
REVOKE ALL ON FUNCTION public.handle_new_user()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_default_stages()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- FILE: 20260616063510_156593ed-dd1f-47b7-9b89-11dc5b7291b6.sql
-- ------------------------------------------------------------


-- ============ DROP OLD ============
DROP TABLE IF EXISTS public.payrolls CASCADE;
DROP TABLE IF EXISTS public.attendances CASCADE;
DROP TABLE IF EXISTS public.job_logs CASCADE;
DROP TABLE IF EXISTS public.job_rates CASCADE;
DROP TABLE IF EXISTS public.production_stages CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.project_assignments CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.employees CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role) CASCADE;
DROP FUNCTION IF EXISTS public.is_staff(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_default_stages() CASCADE;
DROP FUNCTION IF EXISTS public.calc_job_log_amount() CASCADE;

DROP TYPE IF EXISTS public.app_role CASCADE;
DROP TYPE IF EXISTS public.employee_type CASCADE;
DROP TYPE IF EXISTS public.project_status CASCADE;
DROP TYPE IF EXISTS public.job_log_status CASCADE;
DROP TYPE IF EXISTS public.attendance_status CASCADE;
DROP TYPE IF EXISTS public.payroll_status CASCADE;
DROP TYPE IF EXISTS public.order_status CASCADE;
DROP TYPE IF EXISTS public.stage_status CASCADE;

-- ============ ENUMS ============
CREATE TYPE public.app_role         AS ENUM ('owner','admin','karyawan');
CREATE TYPE public.employee_type    AS ENUM ('borongan','harian');
CREATE TYPE public.project_status   AS ENUM ('draft','active','done','cancelled');
CREATE TYPE public.job_log_status   AS ENUM ('pending','approved','rejected');
CREATE TYPE public.attendance_status AS ENUM ('hadir','izin','sakit','alpa');
CREATE TYPE public.payroll_status   AS ENUM ('draft','approved','paid');

-- ============ updated_at trigger fn ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ user_roles ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============ has_role (security definer) ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','owner'))
$$;

-- profiles policies
CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admin update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin_or_owner(auth.uid()));

-- user_roles policies
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "owner manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));

-- ============ handle_new_user ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count int;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'karyawan');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ employees ============
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text,
  type public.employee_type NOT NULL DEFAULT 'borongan',
  daily_wage numeric(12,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "read own employee or staff" ON public.employees FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin manage employees" ON public.employees FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- ============ customers ============
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  address text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "staff read customers" ON public.customers FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin manage customers" ON public.customers FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- ============ projects ============
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  deadline date,
  status public.project_status NOT NULL DEFAULT 'draft',
  total_points int NOT NULL DEFAULT 0,
  contract_value numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ project_assignments ============
CREATE TABLE public.project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_assignments TO authenticated;
GRANT ALL ON public.project_assignments TO service_role;
ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

-- projects RLS: karyawan boleh lihat project yang di-assign ke dia
CREATE POLICY "staff read all projects" ON public.projects FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "karyawan read assigned projects" ON public.projects FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_assignments pa
    JOIN public.employees e ON e.id = pa.employee_id
    WHERE pa.project_id = projects.id AND e.profile_id = auth.uid()
  ));
CREATE POLICY "admin manage projects" ON public.projects FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- assignments RLS
CREATE POLICY "staff read assignments" ON public.project_assignments FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid())
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid()));
CREATE POLICY "admin manage assignments" ON public.project_assignments FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- ============ job_rates ============
CREATE TABLE public.job_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'titik',
  rate_per_unit numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_rates TO authenticated;
GRANT ALL ON public.job_rates TO service_role;
ALTER TABLE public.job_rates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_rates_updated BEFORE UPDATE ON public.job_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "auth read rates" ON public.job_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage rates" ON public.job_rates FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- ============ job_logs ============
CREATE TABLE public.job_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  rate_id uuid NOT NULL REFERENCES public.job_rates(id),
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  qty numeric(10,2) NOT NULL CHECK (qty > 0),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  photo_url text,
  status public.job_log_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_logs TO authenticated;
GRANT ALL ON public.job_logs TO service_role;
ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_joblogs_updated BEFORE UPDATE ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auto-calc amount
CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r numeric;
BEGIN
  SELECT rate_per_unit INTO r FROM public.job_rates WHERE id = NEW.rate_id;
  NEW.amount := COALESCE(r,0) * NEW.qty;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_joblogs_amount BEFORE INSERT OR UPDATE OF qty, rate_id ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.calc_job_log_amount();

CREATE POLICY "karyawan read own logs" ON public.job_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
         OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "karyawan insert own logs" ON public.job_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
              AND status = 'pending');
CREATE POLICY "karyawan update own pending" ON public.job_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid()) AND status = 'pending')
  WITH CHECK (status = 'pending');
CREATE POLICY "admin manage logs" ON public.job_logs FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- ============ attendances ============
CREATE TABLE public.attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  check_in timestamptz,
  check_out timestamptz,
  status public.attendance_status NOT NULL DEFAULT 'hadir',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendances TO authenticated;
GRANT ALL ON public.attendances TO service_role;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_att_updated BEFORE UPDATE ON public.attendances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "att read own or staff" ON public.attendances FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
         OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "att insert own" ON public.attendances FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid()));
CREATE POLICY "att update own today" ON public.attendances FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid()) AND date = CURRENT_DATE)
  WITH CHECK (date = CURRENT_DATE);
CREATE POLICY "admin manage att" ON public.attendances FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- ============ payrolls ============
CREATE TABLE public.payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  base numeric(14,2) NOT NULL DEFAULT 0,
  bonus numeric(14,2) NOT NULL DEFAULT 0,
  deductions numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_start, period_end)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payrolls TO authenticated;
GRANT ALL ON public.payrolls TO service_role;
ALTER TABLE public.payrolls ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_payroll_updated BEFORE UPDATE ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "payroll read own or staff" ON public.payrolls FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
         OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin draft payroll" ON public.payrolls FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin update payroll" ON public.payrolls FOR UPDATE TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "owner delete payroll" ON public.payrolls FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'owner'));


-- ------------------------------------------------------------
-- FILE: 20260616063540_4f1c9663-37e6-4fbb-aff3-8690eb4ba7cc.sql
-- ------------------------------------------------------------


REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_admin_or_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.calc_job_log_amount() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calc_job_log_amount() TO service_role;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;


-- ------------------------------------------------------------
-- FILE: 20260616070624_b0495f72-9475-465f-b3ec-dc5582fc638c.sql
-- ------------------------------------------------------------

TRUNCATE TABLE public.payrolls, public.attendances, public.job_logs, public.project_assignments, public.projects, public.customers, public.job_rates, public.employees, public.user_roles, public.profiles RESTART IDENTITY CASCADE;
DELETE FROM auth.users;

-- ------------------------------------------------------------
-- FILE: 20260616074701_57922524-24b0-49f4-9875-a05c6da4e318.sql
-- ------------------------------------------------------------

CREATE POLICY "karyawan read active projects" ON public.projects FOR SELECT TO authenticated USING (status IN ('draft','active'));

-- ------------------------------------------------------------
-- FILE: 20260616075112_d95b5f18-ffaa-4cce-8648-281d3824b13b.sql
-- ------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.code, p.title, p.status, p.total_points,
    COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl WHERE jl.project_id = p.id AND jl.status <> 'rejected'), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl WHERE jl.project_id = p.id AND jl.status <> 'rejected'), 0), 0) AS remaining_points
  FROM public.projects p
  WHERE p.status IN ('draft','active')
  ORDER BY p.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  total int;
  claimed numeric;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND status <> 'rejected'
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_project_point_limit ON public.job_logs;
CREATE TRIGGER trg_enforce_project_point_limit
  BEFORE INSERT OR UPDATE OF qty, project_id, status ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_point_limit();


-- ------------------------------------------------------------
-- FILE: 20260616080535_05e475e5-93bf-4bfd-b0c6-34131c0e0af5.sql
-- ------------------------------------------------------------


-- Update trigger: enforce limit per (project_id, rate_id)
CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  total int;
  claimed numeric;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND rate_id = NEW.rate_id
      AND status <> 'rejected'
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END; $function$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_enforce_project_point_limit ON public.job_logs;
CREATE TRIGGER trg_enforce_project_point_limit
  BEFORE INSERT OR UPDATE ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_point_limit();

-- New function: per-rate availability for a project
CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
RETURNS TABLE(rate_id uuid, rate_name text, unit text, rate_per_unit numeric, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    r.id AS rate_id,
    r.name AS rate_name,
    r.unit,
    r.rate_per_unit,
    p.total_points,
    COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl
              WHERE jl.project_id = p.id AND jl.rate_id = r.id AND jl.status <> 'rejected'), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl
              WHERE jl.project_id = p.id AND jl.rate_id = r.id AND jl.status <> 'rejected'), 0), 0) AS remaining_points
  FROM public.projects p
  CROSS JOIN public.job_rates r
  WHERE p.id = _project_id AND r.active = true
  ORDER BY r.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) TO authenticated;


-- ------------------------------------------------------------
-- FILE: 20260616081629_ecb9b504-f9a6-4196-afe0-eef78125240b.sql
-- ------------------------------------------------------------


-- 1. Allow karyawan to delete their own pending logs
CREATE POLICY "karyawan delete own pending" ON public.job_logs
FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.employees e WHERE e.id = job_logs.employee_id AND e.profile_id = auth.uid())
  AND status = 'pending'
);

-- 2. Attendance secret table (single row)
CREATE TABLE public.attendance_settings (
  id int PRIMARY KEY DEFAULT 1,
  secret text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO public.attendance_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT ON public.attendance_settings TO authenticated;
GRANT ALL ON public.attendance_settings TO service_role;
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;
-- No policies: only accessible via SECURITY DEFINER functions

-- 3. Function: owner/admin reads the secret (used client-side to render rotating QR)
CREATE OR REPLACE FUNCTION public.get_attendance_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  RETURN s;
END $$;

-- 4. Function: rotate secret (owner only)
CREATE OR REPLACE FUNCTION public.rotate_attendance_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Forbidden: hanya owner';
  END IF;
  UPDATE public.attendance_settings
    SET secret = encode(gen_random_bytes(32), 'hex'), updated_at = now()
    WHERE id = 1
    RETURNING secret INTO s;
  RETURN s;
END $$;

-- 5. Function: employee scans QR -> verifies token and records attendance
CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  s text;
  win bigint;
  w bigint;
  expected text;
  is_valid boolean := false;
  emp_id uuid;
  today_date date := current_date;
  now_ts timestamptz := now();
  existing_id uuid;
  existing_in timestamptz;
  existing_out timestamptz;
  action text;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN
    RAISE EXCEPTION 'Token tidak valid';
  END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 6)::bigint;
  -- accept current window and one before (tolerance ~6s)
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN
    RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang';
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN
    RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif';
  END IF;

  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $$;

GRANT EXECUTE ON FUNCTION public.get_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text) TO authenticated;


-- ------------------------------------------------------------
-- FILE: 20260616083223_b9f91f0e-a3b3-4b54-b3d3-cd1b0aee733b.sql
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "att insert own" ON public.attendances;
DROP POLICY IF EXISTS "att update own today" ON public.attendances;
-- Read-own and admin-manage policies remain. All check-in/out writes must now go through
-- public.attendance_check_in(_token) which validates the rotating QR token.

-- ------------------------------------------------------------
-- FILE: 20260616085520_3c27a93e-4f6b-4a30-ad5a-d343bdcf2df2.sql
-- ------------------------------------------------------------


ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_unit text NOT NULL DEFAULT 'day' CHECK (pay_unit IN ('day','hour'));


-- ------------------------------------------------------------
-- FILE: 20260616100351_07ec5652-7813-47bd-92b6-d1aaf952a02e.sql
-- ------------------------------------------------------------


CREATE TABLE public.sync_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  spreadsheet_id text,
  sheet_name text,
  header_row int NOT NULL DEFAULT 1,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  last_sync_inserted int DEFAULT 0,
  last_sync_updated int DEFAULT 0,
  last_sync_skipped int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_settings_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_settings TO authenticated;
GRANT ALL ON public.sync_settings TO service_role;

ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin/owner can view sync_settings"
  ON public.sync_settings FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));

CREATE POLICY "owner can update sync_settings"
  ON public.sync_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "owner can insert sync_settings"
  ON public.sync_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER trg_sync_settings_updated
  BEFORE UPDATE ON public.sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sync_settings (id, spreadsheet_id, sheet_name, mapping)
VALUES (1, '17TavOyXTnDAkpdZutI8-aPEE2oB2Qf4i', 'ORDER NEON', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;


-- ------------------------------------------------------------
-- FILE: 20260616124941_84f6d577-30ea-4c91-a494-398c7ee1295a.sql
-- ------------------------------------------------------------


-- Source enum
DO $$ BEGIN
  CREATE TYPE public.order_source AS ENUM ('shopee','tiktok','tokopedia','lazada','direct','lainnya');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Master prices
CREATE TABLE IF NOT EXISTS public.material_prices (
  key text PRIMARY KEY,
  label text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  unit text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.material_prices TO authenticated;
GRANT ALL ON public.material_prices TO service_role;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read prices" ON public.material_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner write prices" ON public.material_prices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

INSERT INTO public.material_prices(key,label,value,unit) VALUES
  ('led_per_meter','LED Strip',7000,'per meter'),
  ('akrilik_per_cm2','Akrilik',20,'per cm²'),
  ('solder_per_titik','Solder',1300,'per titik'),
  ('tempel_per_titik','Tempel',2000,'per titik'),
  ('kabel_per_meter','Kabel',1300,'per meter'),
  ('socket_dc_default','Socket DC (default)',700,'per pcs'),
  ('baut_fischer_default','Baut Fischer (default)',3000,'per set'),
  ('modul_default','Modul (default)',4000,'per pcs'),
  ('adaptor_default','Adaptor (default)',8000,'per pcs'),
  ('print_default','Print (default)',0,'per order'),
  ('karet_seal_default','Karet Seal (default)',0,'per order')
ON CONFLICT (key) DO NOTHING;

-- Orders
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source public.order_source NOT NULL DEFAULT 'shopee',
  order_no text NOT NULL UNIQUE,
  co_date date,
  username text,
  kota text,
  text_neon text NOT NULL,
  paket text,
  akrilik_p numeric NOT NULL DEFAULT 0,
  akrilik_l numeric NOT NULL DEFAULT 0,
  led_meter numeric NOT NULL DEFAULT 0,
  titik integer NOT NULL DEFAULT 0,
  kabel_meter numeric NOT NULL DEFAULT 0,
  payment numeric NOT NULL DEFAULT 0,
  split numeric NOT NULL DEFAULT 0,
  adaptor numeric NOT NULL DEFAULT 0,
  modul numeric NOT NULL DEFAULT 0,
  print_cost numeric NOT NULL DEFAULT 0,
  karet_seal numeric NOT NULL DEFAULT 0,
  socket_dc numeric NOT NULL DEFAULT 0,
  baut_fischer numeric NOT NULL DEFAULT 0,
  led_cost numeric NOT NULL DEFAULT 0,
  akrilik_cost numeric NOT NULL DEFAULT 0,
  solder_cost numeric NOT NULL DEFAULT 0,
  tempel_cost numeric NOT NULL DEFAULT 0,
  kabel_cost numeric NOT NULL DEFAULT 0,
  hpp numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  notes text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner admin write orders" ON public.orders FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid()))
  WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE INDEX IF NOT EXISTS orders_co_date_idx ON public.orders(co_date DESC);
CREATE INDEX IF NOT EXISTS orders_source_idx ON public.orders(source);

-- Calc trigger
CREATE OR REPLACE FUNCTION public.calc_order_costs()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  led_rate numeric;
  akr_rate numeric;
  sol_rate numeric;
  tem_rate numeric;
  kab_rate numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';

  -- kabel auto kalau 0
  IF NEW.kabel_meter IS NULL OR NEW.kabel_meter = 0 THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;

  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));

  NEW.hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0) + COALESCE(NEW.print_cost,0)
           + COALESCE(NEW.karet_seal,0) + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_calc_order_costs ON public.orders;
CREATE TRIGGER trg_calc_order_costs BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.calc_order_costs();

-- Auto sync project
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cust_id uuid;
  cust_name text;
  proj_id uuid;
  proj_code text;
BEGIN
  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET
      code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active')
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET
        title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_order_project ON public.orders;
CREATE TRIGGER trg_sync_order_project AFTER INSERT OR UPDATE OF order_no, text_neon, username, kota, titik, payment ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_to_project();


-- ------------------------------------------------------------
-- FILE: 20260617052513_18f941e5-5ef1-4b30-8269-a9145f816ad4.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s text;
  win bigint;
  w bigint;
  expected text;
  is_valid boolean := false;
  emp_id uuid;
  today_date date := current_date;
  now_ts timestamptz := now();
  existing_id uuid;
  existing_in timestamptz;
  existing_out timestamptz;
  action text;
  mins_since_in numeric;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN
    RAISE EXCEPTION 'Token tidak valid';
  END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 6)::bigint;
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN
    RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang';
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN
    RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif';
  END IF;

  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    mins_since_in := EXTRACT(EPOCH FROM (now_ts - existing_in)) / 60.0;
    IF mins_since_in < 60 THEN
      RAISE EXCEPTION 'Check-out minimal 1 jam setelah check-in. Sisa waktu: % menit', CEIL(60 - mins_since_in);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $function$;

-- ------------------------------------------------------------
-- FILE: 20260617052706_15e8d76a-6d27-4e2e-a255-0ae60e5e8d60.sql
-- ------------------------------------------------------------

DELETE FROM public.attendances WHERE date = current_date;

-- ------------------------------------------------------------
-- FILE: 20260617065723_9a20bfb0-da44-4614-b637-a74d87ef04a5.sql
-- ------------------------------------------------------------


ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS dp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outdoor_cost numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.calc_order_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric;
  akr_rate numeric;
  sol_rate numeric;
  tem_rate numeric;
  kab_rate numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';

  IF NEW.kabel_meter IS NULL OR NEW.kabel_meter = 0 THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;

  IF NEW.outdoor_cost IS NULL OR NEW.outdoor_cost = 0 THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;

  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));

  NEW.hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0) + COALESCE(NEW.print_cost,0)
           + COALESCE(NEW.karet_seal,0) + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260617073544_cff58f99-b3b6-4a70-8c77-0ee907e55a90.sql
-- ------------------------------------------------------------


ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS kabel_socket_meter numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS kabel_socket_cost numeric NOT NULL DEFAULT 0;

INSERT INTO public.material_prices (key, label, unit, value)
VALUES ('kabel_socket_per_meter', 'Kabel Socket', 'meter', 2500)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.calc_order_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric;
  akr_rate numeric;
  sol_rate numeric;
  tem_rate numeric;
  kab_rate numeric;
  ksk_rate numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';

  IF NEW.kabel_meter IS NULL OR NEW.kabel_meter = 0 THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;

  IF NEW.outdoor_cost IS NULL OR NEW.outdoor_cost = 0 THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;

  IF NEW.kabel_socket_meter IS NULL THEN
    NEW.kabel_socket_meter := 1;
  END IF;

  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));

  NEW.hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0) + COALESCE(NEW.print_cost,0)
           + COALESCE(NEW.karet_seal,0) + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260622083102_7c916d22-e49a-4ee0-bd6f-c465a170a966.sql
-- ------------------------------------------------------------

-- See /tmp/all_migrations.sql — full restore

-- ------------------------------------------------------------
-- FILE: 20260622083313_a9f11d2a-1988-4588-9a85-c6282d84e10a.sql
-- ------------------------------------------------------------

-- ============ DROP OLD (no-op for a fresh DB) ============
DROP TABLE IF EXISTS public.payrolls CASCADE;
DROP TABLE IF EXISTS public.attendances CASCADE;
DROP TABLE IF EXISTS public.job_logs CASCADE;
DROP TABLE IF EXISTS public.job_rates CASCADE;
DROP TABLE IF EXISTS public.production_stages CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.project_assignments CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.employees CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role) CASCADE;
DROP FUNCTION IF EXISTS public.is_staff(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_default_stages() CASCADE;
DROP FUNCTION IF EXISTS public.calc_job_log_amount() CASCADE;

DROP TYPE IF EXISTS public.app_role CASCADE;
DROP TYPE IF EXISTS public.employee_type CASCADE;
DROP TYPE IF EXISTS public.project_status CASCADE;
DROP TYPE IF EXISTS public.job_log_status CASCADE;
DROP TYPE IF EXISTS public.attendance_status CASCADE;
DROP TYPE IF EXISTS public.payroll_status CASCADE;
DROP TYPE IF EXISTS public.order_status CASCADE;
DROP TYPE IF EXISTS public.stage_status CASCADE;

-- ============ ENUMS ============
CREATE TYPE public.app_role         AS ENUM ('owner','admin','karyawan');
CREATE TYPE public.employee_type    AS ENUM ('borongan','harian');
CREATE TYPE public.project_status   AS ENUM ('draft','active','done','cancelled');
CREATE TYPE public.job_log_status   AS ENUM ('pending','approved','rejected');
CREATE TYPE public.attendance_status AS ENUM ('hadir','izin','sakit','alpa');
CREATE TYPE public.payroll_status   AS ENUM ('draft','approved','paid');

-- ============ updated_at trigger fn ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ user_roles ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','owner'))
$$;

CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admin update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin_or_owner(auth.uid()));

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "owner manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count int;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'karyawan');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text,
  type public.employee_type NOT NULL DEFAULT 'borongan',
  daily_wage numeric(12,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  hourly_rate numeric NOT NULL DEFAULT 0,
  pay_unit text NOT NULL DEFAULT 'day' CHECK (pay_unit IN ('day','hour')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "read own employee or staff" ON public.employees FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin manage employees" ON public.employees FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  address text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "staff read customers" ON public.customers FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin manage customers" ON public.customers FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  deadline date,
  status public.project_status NOT NULL DEFAULT 'draft',
  total_points int NOT NULL DEFAULT 0,
  contract_value numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_assignments TO authenticated;
GRANT ALL ON public.project_assignments TO service_role;
ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read all projects" ON public.projects FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "karyawan read assigned projects" ON public.projects FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_assignments pa
    JOIN public.employees e ON e.id = pa.employee_id
    WHERE pa.project_id = projects.id AND e.profile_id = auth.uid()
  ));
CREATE POLICY "karyawan read active projects" ON public.projects FOR SELECT TO authenticated USING (status IN ('draft','active'));
CREATE POLICY "admin manage projects" ON public.projects FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE POLICY "staff read assignments" ON public.project_assignments FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid())
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid()));
CREATE POLICY "admin manage assignments" ON public.project_assignments FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TABLE public.job_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'titik',
  rate_per_unit numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_rates TO authenticated;
GRANT ALL ON public.job_rates TO service_role;
ALTER TABLE public.job_rates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_rates_updated BEFORE UPDATE ON public.job_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "auth read rates" ON public.job_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage rates" ON public.job_rates FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TABLE public.job_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  rate_id uuid NOT NULL REFERENCES public.job_rates(id),
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  qty numeric(10,2) NOT NULL CHECK (qty > 0),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  photo_url text,
  status public.job_log_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_logs TO authenticated;
GRANT ALL ON public.job_logs TO service_role;
ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_joblogs_updated BEFORE UPDATE ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r numeric;
BEGIN
  SELECT rate_per_unit INTO r FROM public.job_rates WHERE id = NEW.rate_id;
  NEW.amount := COALESCE(r,0) * NEW.qty;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_joblogs_amount BEFORE INSERT OR UPDATE OF qty, rate_id ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.calc_job_log_amount();

CREATE POLICY "karyawan read own logs" ON public.job_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
         OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "karyawan insert own logs" ON public.job_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
              AND status = 'pending');
CREATE POLICY "karyawan update own pending" ON public.job_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid()) AND status = 'pending')
  WITH CHECK (status = 'pending');
CREATE POLICY "karyawan delete own pending" ON public.job_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = job_logs.employee_id AND e.profile_id = auth.uid()) AND status = 'pending');
CREATE POLICY "admin manage logs" ON public.job_logs FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TABLE public.attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  check_in timestamptz,
  check_out timestamptz,
  status public.attendance_status NOT NULL DEFAULT 'hadir',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendances TO authenticated;
GRANT ALL ON public.attendances TO service_role;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_att_updated BEFORE UPDATE ON public.attendances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "att read own or staff" ON public.attendances FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
         OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin manage att" ON public.attendances FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TABLE public.payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  base numeric(14,2) NOT NULL DEFAULT 0,
  bonus numeric(14,2) NOT NULL DEFAULT 0,
  deductions numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_start, period_end)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payrolls TO authenticated;
GRANT ALL ON public.payrolls TO service_role;
ALTER TABLE public.payrolls ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_payroll_updated BEFORE UPDATE ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "payroll read own or staff" ON public.payrolls FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.profile_id = auth.uid())
         OR public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin draft payroll" ON public.payrolls FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "admin update payroll" ON public.payrolls FOR UPDATE TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "owner delete payroll" ON public.payrolls FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'owner'));

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_admin_or_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.calc_job_log_amount() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calc_job_log_amount() TO service_role;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- ------------------------------------------------------------
-- FILE: 20260622083428_a540d2a6-337b-4782-aece-f02360520084.sql
-- ------------------------------------------------------------

-- get_available_projects (for karyawan)
CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.code, p.title, p.status, p.total_points,
    COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl WHERE jl.project_id = p.id AND jl.status <> 'rejected'), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl WHERE jl.project_id = p.id AND jl.status <> 'rejected'), 0), 0) AS remaining_points
  FROM public.projects p
  WHERE p.status IN ('draft','active')
  ORDER BY p.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

-- enforce per-(project,rate) point limit on job_logs
CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE total int; claimed numeric;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND rate_id = NEW.rate_id
      AND status <> 'rejected'
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enforce_project_point_limit ON public.job_logs;
CREATE TRIGGER trg_enforce_project_point_limit
  BEFORE INSERT OR UPDATE ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_point_limit();

CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
RETURNS TABLE(rate_id uuid, rate_name text, unit text, rate_per_unit numeric, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.name, r.unit, r.rate_per_unit, p.total_points,
    COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl
              WHERE jl.project_id = p.id AND jl.rate_id = r.id AND jl.status <> 'rejected'), 0),
    GREATEST(p.total_points - COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl
              WHERE jl.project_id = p.id AND jl.rate_id = r.id AND jl.status <> 'rejected'), 0), 0)
  FROM public.projects p CROSS JOIN public.job_rates r
  WHERE p.id = _project_id AND r.active = true
  ORDER BY r.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) TO authenticated;

-- attendance secret settings
CREATE TABLE public.attendance_settings (
  id int PRIMARY KEY DEFAULT 1,
  secret text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO public.attendance_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.attendance_settings TO authenticated;
GRANT ALL ON public.attendance_settings TO service_role;
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_attendance_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.rotate_attendance_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Forbidden: hanya owner'; END IF;
  UPDATE public.attendance_settings
    SET secret = encode(gen_random_bytes(32), 'hex'), updated_at = now()
    WHERE id = 1 RETURNING secret INTO s;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid; today_date date := current_date; now_ts timestamptz := now();
  existing_id uuid; existing_in timestamptz; existing_out timestamptz; action text;
  mins_since_in numeric;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 6)::bigint;
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;
  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;
  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir') RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    mins_since_in := EXTRACT(EPOCH FROM (now_ts - existing_in)) / 60.0;
    IF mins_since_in < 60 THEN
      RAISE EXCEPTION 'Check-out minimal 1 jam setelah check-in. Sisa waktu: % menit', CEIL(60 - mins_since_in);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;
  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $$;
GRANT EXECUTE ON FUNCTION public.get_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_attendance_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text) TO authenticated;

-- sync_settings
CREATE TABLE public.sync_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  spreadsheet_id text,
  sheet_name text,
  header_row int NOT NULL DEFAULT 1,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  last_sync_inserted int DEFAULT 0,
  last_sync_updated int DEFAULT 0,
  last_sync_skipped int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_settings_singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_settings TO authenticated;
GRANT ALL ON public.sync_settings TO service_role;
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin/owner can view sync_settings" ON public.sync_settings FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));
CREATE POLICY "owner can update sync_settings" ON public.sync_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "owner can insert sync_settings" ON public.sync_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'));
CREATE TRIGGER trg_sync_settings_updated BEFORE UPDATE ON public.sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.sync_settings (id, spreadsheet_id, sheet_name, mapping)
VALUES (1, '17TavOyXTnDAkpdZutI8-aPEE2oB2Qf4i', 'ORDER NEON', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- order_source enum + material_prices + orders
DO $$ BEGIN CREATE TYPE public.order_source AS ENUM ('shopee','tiktok','tokopedia','lazada','direct','lainnya'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.material_prices (
  key text PRIMARY KEY,
  label text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  unit text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.material_prices TO authenticated;
GRANT ALL ON public.material_prices TO service_role;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read prices" ON public.material_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner write prices" ON public.material_prices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));

INSERT INTO public.material_prices(key,label,value,unit) VALUES
  ('led_per_meter','LED Strip',7000,'per meter'),
  ('akrilik_per_cm2','Akrilik',20,'per cm²'),
  ('solder_per_titik','Solder',1300,'per titik'),
  ('tempel_per_titik','Tempel',2000,'per titik'),
  ('kabel_per_meter','Kabel',1300,'per meter'),
  ('socket_dc_default','Socket DC (default)',700,'per pcs'),
  ('baut_fischer_default','Baut Fischer (default)',3000,'per set'),
  ('modul_default','Modul (default)',4000,'per pcs'),
  ('adaptor_default','Adaptor (default)',8000,'per pcs'),
  ('print_default','Print (default)',0,'per order'),
  ('karet_seal_default','Karet Seal (default)',0,'per order'),
  ('kabel_socket_per_meter','Kabel Socket',2500,'meter')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source public.order_source NOT NULL DEFAULT 'shopee',
  order_no text NOT NULL UNIQUE,
  co_date date,
  username text,
  kota text,
  text_neon text NOT NULL,
  paket text,
  akrilik_p numeric NOT NULL DEFAULT 0,
  akrilik_l numeric NOT NULL DEFAULT 0,
  led_meter numeric NOT NULL DEFAULT 0,
  titik integer NOT NULL DEFAULT 0,
  kabel_meter numeric NOT NULL DEFAULT 0,
  payment numeric NOT NULL DEFAULT 0,
  split numeric NOT NULL DEFAULT 0,
  adaptor numeric NOT NULL DEFAULT 0,
  modul numeric NOT NULL DEFAULT 0,
  print_cost numeric NOT NULL DEFAULT 0,
  karet_seal numeric NOT NULL DEFAULT 0,
  socket_dc numeric NOT NULL DEFAULT 0,
  baut_fischer numeric NOT NULL DEFAULT 0,
  led_cost numeric NOT NULL DEFAULT 0,
  akrilik_cost numeric NOT NULL DEFAULT 0,
  solder_cost numeric NOT NULL DEFAULT 0,
  tempel_cost numeric NOT NULL DEFAULT 0,
  kabel_cost numeric NOT NULL DEFAULT 0,
  hpp numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  notes text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  dp numeric NOT NULL DEFAULT 0,
  outdoor_cost numeric NOT NULL DEFAULT 0,
  kabel_socket_meter numeric NOT NULL DEFAULT 1,
  kabel_socket_cost numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner admin write orders" ON public.orders FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));
CREATE INDEX orders_co_date_idx ON public.orders(co_date DESC);
CREATE INDEX orders_source_idx ON public.orders(source);

CREATE OR REPLACE FUNCTION public.calc_order_costs()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL OR NEW.kabel_meter = 0 THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL OR NEW.outdoor_cost = 0 THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  NEW.hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0) + COALESCE(NEW.print_cost,0)
           + COALESCE(NEW.karet_seal,0) + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_calc_order_costs BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.calc_order_costs();

CREATE OR REPLACE FUNCTION public.sync_order_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cust_id uuid; cust_name text; proj_id uuid; proj_code text;
BEGIN
  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active')
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sync_order_project AFTER INSERT OR UPDATE OF order_no, text_neon, username, kota, titik, payment ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_to_project();

-- ------------------------------------------------------------
-- FILE: 20260623080420_0887842a-839d-43ab-8234-32f1aff8d160.sql
-- ------------------------------------------------------------


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


-- ------------------------------------------------------------
-- FILE: 20260623083512_ffe650e7-c56c-4299-882f-54ef5cc42204.sql
-- ------------------------------------------------------------


-- 1) orders: add status & adaptor_type
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS adaptor_type text;
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_status_chk CHECK (status IN ('active','return','draft'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

-- 2) material_prices: adaptor variants + marketplace markup percentage
INSERT INTO public.material_prices(key,label,value,unit) VALUES
  ('adaptor_2a','Adaptor 2A (≤3m LED)',8000,'per pcs'),
  ('adaptor_3a','Adaptor 3A (≤5m LED)',15000,'per pcs'),
  ('adaptor_3a_murni','Adaptor 3A Murni (≤8m LED)',30000,'per pcs'),
  ('adaptor_5a_murni','Adaptor 5A Murni (≤11m LED)',40000,'per pcs'),
  ('marketplace_markup_pct','Markup Harga Marketplace',22,'persen')
ON CONFLICT (key) DO NOTHING;

-- 3) Fix get_available_projects: remaining = total - MAX(claimed per rate)
CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.code, p.title, p.status, p.total_points,
    COALESCE((
      SELECT MAX(s.claimed) FROM (
        SELECT SUM(jl.qty) AS claimed
        FROM public.job_logs jl
        WHERE jl.project_id = p.id AND jl.status <> 'rejected'
        GROUP BY jl.rate_id
      ) s
    ), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((
      SELECT MAX(s.claimed) FROM (
        SELECT SUM(jl.qty) AS claimed
        FROM public.job_logs jl
        WHERE jl.project_id = p.id AND jl.status <> 'rejected'
        GROUP BY jl.rate_id
      ) s
    ), 0), 0) AS remaining_points
  FROM public.projects p
  WHERE p.status IN ('draft','active')
  ORDER BY p.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

-- 4) QR Absensi: rotate every 10 seconds
CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid; today_date date := current_date; now_ts timestamptz := now();
  existing_id uuid; existing_in timestamptz; existing_out timestamptz; action text;
  mins_since_in numeric;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 10)::bigint;
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;
  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;
  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir') RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    mins_since_in := EXTRACT(EPOCH FROM (now_ts - existing_in)) / 60.0;
    IF mins_since_in < 60 THEN
      RAISE EXCEPTION 'Check-out minimal 1 jam setelah check-in. Sisa waktu: % menit', CEIL(60 - mins_since_in);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;
  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $$;
REVOKE EXECUTE ON FUNCTION public.attendance_check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text) TO authenticated;

-- 5) Allow karyawan to update note on their own attendance
CREATE OR REPLACE FUNCTION public.set_attendance_note(_attendance_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owns boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.attendances a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = _attendance_id AND (e.profile_id = auth.uid() OR public.is_admin_or_owner(auth.uid()))
  ) INTO owns;
  IF NOT owns THEN RAISE EXCEPTION 'Tidak diizinkan mengubah catatan absensi ini'; END IF;
  UPDATE public.attendances SET note = _note, updated_at = now() WHERE id = _attendance_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_attendance_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_note(uuid, text) TO authenticated;


-- ------------------------------------------------------------
-- FILE: 20260623085215_b0063dd9-35ed-4e32-a3dd-7f813943bb98.sql
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.rotate_attendance_secret()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE s text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Forbidden: hanya owner'; END IF;
  UPDATE public.attendance_settings
    SET secret = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
    WHERE id = 1 RETURNING secret INTO s;
  IF s IS NULL THEN
    INSERT INTO public.attendance_settings(id, secret)
      VALUES (1, encode(extensions.gen_random_bytes(32), 'hex'))
      RETURNING secret INTO s;
  END IF;
  RETURN s;
END $function$;

-- ------------------------------------------------------------
-- FILE: 20260623090428_c3647593-e61a-481f-b9c9-43cfe3b60c73.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(
  id uuid,
  code text,
  title text,
  status project_status,
  total_points integer,
  claimed_points numeric,
  remaining_points numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id
    FROM public.job_rates
    WHERE active = true
  ), project_availability AS (
    SELECT
      p.id,
      p.code,
      p.title,
      p.status,
      (p.total_points * COUNT(ar.id))::integer AS total_points,
      COALESCE(SUM(LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)), 0) AS claimed_points,
      COALESCE(SUM(GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)), 0) AS remaining_points,
      p.created_at
    FROM public.projects p
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty
      FROM public.job_logs jl
      WHERE jl.project_id = p.id
        AND jl.rate_id = ar.id
        AND jl.status <> 'rejected'
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.total_points, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points
  FROM project_availability
  ORDER BY created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260624084257_4c95bb24-3486-4431-8266-bda8044441c2.sql
-- ------------------------------------------------------------


-- 1) Fix attendance timezone to Asia/Jakarta (UTC+7)
CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid;
  now_ts timestamptz := now();
  today_date date := (now_ts AT TIME ZONE 'Asia/Jakarta')::date;
  existing_id uuid; existing_in timestamptz; existing_out timestamptz; action text;
  mins_since_in numeric;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  win := floor(extract(epoch FROM now_ts) / 10)::bigint;
  FOR w IN win-1..win+1 LOOP
    expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
    IF expected = _token THEN is_valid := true; EXIT; END IF;
  END LOOP;
  IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;
  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;
  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir') RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    mins_since_in := EXTRACT(EPOCH FROM (now_ts - existing_in)) / 60.0;
    IF mins_since_in < 60 THEN
      RAISE EXCEPTION 'Check-out minimal 1 jam setelah check-in. Sisa waktu: % menit', CEIL(60 - mins_since_in);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;
  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $function$;

-- 2) Don't create/sync project for draft orders; clean up project when order returns to draft
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; proj_code text; has_logs boolean;
BEGIN
  -- If order is draft: do not create a project. If a project was linked, detach
  -- and delete it when there are no job_logs referencing it.
  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN
        DELETE FROM public.projects WHERE id = proj_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active')
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- Ensure trigger fires when status changes too
DROP TRIGGER IF EXISTS trg_sync_order_project ON public.orders;
CREATE TRIGGER trg_sync_order_project
AFTER INSERT OR UPDATE OF order_no, text_neon, username, kota, titik, payment, status
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_order_to_project();

-- 3) Clean up existing projects that came from draft orders and have no work logged
DELETE FROM public.projects p
WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.project_id = p.id AND o.status = 'draft')
  AND NOT EXISTS (SELECT 1 FROM public.job_logs jl WHERE jl.project_id = p.id);

UPDATE public.orders SET project_id = NULL
WHERE status = 'draft' AND project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = orders.project_id);


-- ------------------------------------------------------------
-- FILE: 20260624112555_c307cd4c-f7dd-425c-8ca2-e2296cda35ae.sql
-- ------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid;
  now_ts timestamptz := now();
  today_date date := (now_ts AT TIME ZONE 'Asia/Jakarta')::date;
  existing_id uuid; existing_in timestamptz; existing_out timestamptz; action text;
  mins_since_in numeric;
  daily_date text;
  daily_sig text;
  daily_expected text;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;

  -- Daily backup token format: DLY:YYYYMMDD:<16 hex>
  IF _token LIKE 'DLY:%' THEN
    daily_date := split_part(_token, ':', 2);
    daily_sig  := split_part(_token, ':', 3);
    IF daily_date IS NULL OR length(daily_date) <> 8 OR daily_sig IS NULL OR length(daily_sig) <> 16 THEN
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
    IF daily_date <> to_char(today_date, 'YYYYMMDD') THEN
      RAISE EXCEPTION 'QR harian sudah kadaluarsa (hanya berlaku untuk tanggal %)', daily_date;
    END IF;
    daily_expected := substr(encode(extensions.hmac('DAILY:' || daily_date, s, 'sha256'), 'hex'), 1, 16);
    IF daily_expected = daily_sig THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
  ELSE
    win := floor(extract(epoch FROM now_ts) / 10)::bigint;
    FOR w IN win-1..win+1 LOOP
      expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
      IF expected = _token THEN is_valid := true; EXIT; END IF;
    END LOOP;
    IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;
  SELECT id, check_in, check_out INTO existing_id, existing_in, existing_out
    FROM public.attendances WHERE employee_id = emp_id AND date = today_date;
  IF existing_id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir') RETURNING id INTO existing_id;
    action := 'check_in';
  ELSIF existing_out IS NULL THEN
    mins_since_in := EXTRACT(EPOCH FROM (now_ts - existing_in)) / 60.0;
    IF mins_since_in < 60 THEN
      RAISE EXCEPTION 'Check-out minimal 1 jam setelah check-in. Sisa waktu: % menit', CEIL(60 - mins_since_in);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = existing_id;
    action := 'check_out';
  ELSE
    RAISE EXCEPTION 'Anda sudah check-in dan check-out hari ini';
  END IF;
  RETURN jsonb_build_object('action', action, 'attendance_id', existing_id, 'time', now_ts);
END $function$;

CREATE OR REPLACE FUNCTION public.get_daily_attendance_token(_date date DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE s text; d date; ymd text; sig text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  d := COALESCE(_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'Secret belum diinisialisasi'; END IF;
  ymd := to_char(d, 'YYYYMMDD');
  sig := substr(encode(extensions.hmac('DAILY:' || ymd, s, 'sha256'), 'hex'), 1, 16);
  RETURN 'DLY:' || ymd || ':' || sig;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260625025518_e21cefaf-9b90-4482-a022-8169c55eac50.sql
-- ------------------------------------------------------------


ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS break_start timestamptz,
  ADD COLUMN IF NOT EXISTS break_end timestamptz;

CREATE OR REPLACE FUNCTION public.attendance_check_in(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid;
  now_ts timestamptz := now();
  today_date date := (now_ts AT TIME ZONE 'Asia/Jakarta')::date;
  rec record;
  action text;
  mins_since_last numeric;
  last_ts timestamptz;
  min_gap_min numeric := 10;
  daily_date text; daily_sig text; daily_expected text;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;

  IF _token LIKE 'DLY:%' THEN
    daily_date := split_part(_token, ':', 2);
    daily_sig  := split_part(_token, ':', 3);
    IF daily_date IS NULL OR length(daily_date) <> 8 OR daily_sig IS NULL OR length(daily_sig) <> 16 THEN
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
    IF daily_date <> to_char(today_date, 'YYYYMMDD') THEN
      RAISE EXCEPTION 'QR harian sudah kadaluarsa (hanya berlaku untuk tanggal %)', daily_date;
    END IF;
    daily_expected := substr(encode(extensions.hmac('DAILY:' || daily_date, s, 'sha256'), 'hex'), 1, 16);
    IF daily_expected = daily_sig THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
  ELSE
    win := floor(extract(epoch FROM now_ts) / 10)::bigint;
    FOR w IN win-1..win+1 LOOP
      expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
      IF expected = _token THEN is_valid := true; EXIT; END IF;
    END LOOP;
    IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;

  SELECT * INTO rec FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF rec.id IS NULL THEN
    -- Scan ke-1: Check-In
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING * INTO rec;
    action := 'check_in';
  ELSIF rec.check_out IS NULL AND rec.break_start IS NULL THEN
    -- Scan ke-2: Check-Out (sementara)
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_in)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out';
  ELSIF rec.check_out IS NOT NULL AND rec.break_start IS NULL THEN
    -- Scan ke-3: scan-2 jadi break_start, scan-3 jadi break_end (lanjut kerja)
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_out)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances
      SET break_start = rec.check_out,
          break_end   = now_ts,
          check_out   = NULL
      WHERE id = rec.id;
    action := 'break_end';
  ELSIF rec.break_end IS NOT NULL AND rec.check_out IS NULL THEN
    -- Scan ke-4: Check-Out final
    last_ts := COALESCE(rec.break_end, rec.check_in);
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - last_ts)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out_final';
  ELSE
    RAISE EXCEPTION 'Anda sudah menyelesaikan absensi hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', rec.id, 'time', now_ts);
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260625031425_01265c42-74c3-4449-a7de-0ce6396025ff.sql
-- ------------------------------------------------------------


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


-- ------------------------------------------------------------
-- FILE: 20260626080727_aeec3596-762c-4b22-8e0b-e090bdac3754.sql
-- ------------------------------------------------------------


ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS biaya_lainnya numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders DROP COLUMN IF EXISTS print_cost;
ALTER TABLE public.orders DROP COLUMN IF EXISTS karet_seal;

DELETE FROM public.material_prices WHERE key IN ('print_default','karet_seal_default');

CREATE OR REPLACE FUNCTION public.calc_order_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL OR NEW.kabel_meter = 0 THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL OR NEW.outdoor_cost = 0 THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

UPDATE public.orders SET updated_at = updated_at WHERE id IS NOT NULL;


-- ------------------------------------------------------------
-- FILE: 20260626081537_24b735df-8843-46c4-80f7-e3cc763f0327.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calc_order_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- ------------------------------------------------------------
-- FILE: 20260626081637_32f546e0-bae5-4287-9974-43dbaec8005d.sql
-- ------------------------------------------------------------

ALTER TABLE public.orders ALTER COLUMN outdoor_cost DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN outdoor_cost DROP DEFAULT;
ALTER TABLE public.orders ALTER COLUMN kabel_meter DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN kabel_meter DROP DEFAULT;

-- ------------------------------------------------------------
-- FILE: 20260629030202_2f6398fc-4e86-4e5e-85c8-44ed79b31eb5.sql
-- ------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status = ANY (ARRAY['active'::text, 'return'::text, 'draft'::text, 'ready_stock'::text]));

-- ------------------------------------------------------------
-- FILE: 20260629030911_86e998c5-2dcd-47ae-a952-23aef27b1a2d.sql
-- ------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT orders_status_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_chk CHECK (status = ANY (ARRAY['active','return','draft','ready_stock']));

-- ------------------------------------------------------------
-- FILE: 20260629031645_80807b1c-72a4-422e-b84c-b2fa5b06a95a.sql
-- ------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.assign_order_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE max_no int;
BEGIN
  -- Normalize empty/null for draft & ready_stock => '0'
  IF NEW.status IN ('draft','ready_stock') THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' THEN
      NEW.order_no := '0';
    END IF;
    RETURN NEW;
  END IF;

  -- For active/return: if order_no kosong atau '0', assign nomor urut berikutnya
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE status NOT IN ('draft','ready_stock')
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_order_no ON public.orders;
CREATE TRIGGER trg_assign_order_no
  BEFORE INSERT OR UPDATE OF status, order_no ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_order_no();


-- ------------------------------------------------------------
-- FILE: 20260629044349_4e3e5a4d-0f5e-410b-ac23-94041a38617a.sql
-- ------------------------------------------------------------


-- 1) Tambah kolom reparasi di job_logs
ALTER TABLE public.job_logs
  ADD COLUMN IF NOT EXISTS is_repair boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repair_reason text,
  ADD COLUMN IF NOT EXISTS source_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_logs_source_order_idx ON public.job_logs(source_order_id) WHERE is_repair = true;

-- 2) Tambah repair_cost ke orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS repair_cost numeric NOT NULL DEFAULT 0;

-- 3) Skip enforce_project_point_limit untuk reparasi
CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE total int; claimed numeric;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND rate_id = NEW.rate_id
      AND status <> 'rejected'
      AND COALESCE(is_repair,false) = false
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END $function$;

-- 4) Sertakan repair_cost dalam HPP order
CREATE OR REPLACE FUNCTION public.calc_order_costs()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0) + COALESCE(NEW.repair_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- 5) Trigger: agregasi repair_cost per order dari approved repair logs
CREATE OR REPLACE FUNCTION public.recalc_order_repair_cost()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE oid uuid; total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    oid := OLD.source_order_id;
  ELSE
    oid := NEW.source_order_id;
  END IF;
  IF oid IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.source_order_id IS NOT NULL AND OLD.source_order_id IS DISTINCT FROM NEW.source_order_id THEN
      SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
        WHERE source_order_id = OLD.source_order_id AND is_repair = true AND status = 'approved';
      UPDATE public.orders SET repair_cost = total WHERE id = OLD.source_order_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
    WHERE source_order_id = oid AND is_repair = true AND status = 'approved';
  UPDATE public.orders SET repair_cost = total WHERE id = oid;
  -- juga update order lama jika source_order_id berubah
  IF TG_OP = 'UPDATE' AND OLD.source_order_id IS NOT NULL AND OLD.source_order_id IS DISTINCT FROM NEW.source_order_id THEN
    SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
      WHERE source_order_id = OLD.source_order_id AND is_repair = true AND status = 'approved';
    UPDATE public.orders SET repair_cost = total WHERE id = OLD.source_order_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS trg_joblogs_repair_cost ON public.job_logs;
CREATE TRIGGER trg_joblogs_repair_cost
AFTER INSERT OR UPDATE OF status, amount, source_order_id, is_repair OR DELETE
ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.recalc_order_repair_cost();

-- 6) RPC approve_job_log: full / partial / reject + optional amount override
CREATE OR REPLACE FUNCTION public.approve_job_log(
  _id uuid,
  _status text,
  _qty numeric DEFAULT NULL,
  _amount numeric DEFAULT NULL
) RETURNS public.job_logs
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE row public.job_logs;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  IF _status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  -- Update qty dulu (trigger calc_job_log_amount akan hitung amount = qty * rate)
  IF _qty IS NOT NULL THEN
    IF _qty <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;
    UPDATE public.job_logs SET qty = _qty WHERE id = _id;
  END IF;

  -- Override amount jika diberikan
  IF _amount IS NOT NULL THEN
    IF _amount < 0 THEN RAISE EXCEPTION 'Nominal tidak boleh negatif'; END IF;
    UPDATE public.job_logs SET amount = _amount WHERE id = _id;
  END IF;

  UPDATE public.job_logs
     SET status = _status::job_log_status,
         approved_by = auth.uid(),
         approved_at = now()
   WHERE id = _id
   RETURNING * INTO row;

  RETURN row;
END $function$;

REVOKE EXECUTE ON FUNCTION public.approve_job_log(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_job_log(uuid, text, numeric, numeric) TO authenticated;

-- 7) Daftar order yang bisa direparasi (active/return)
CREATE OR REPLACE FUNCTION public.get_repairable_orders()
 RETURNS TABLE(id uuid, order_no text, text_neon text, username text, kota text, status text, project_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT id, order_no, text_neon, username, kota, status, project_id
  FROM public.orders
  WHERE status IN ('active','return','ready_stock')
  ORDER BY created_at DESC
  LIMIT 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_repairable_orders() TO authenticated;

-- 8) Recalc existing orders untuk memastikan repair_cost=0 ter-include
UPDATE public.orders SET updated_at = now() WHERE repair_cost = 0;


-- ------------------------------------------------------------
-- FILE: 20260630073136_c83a8a56-8354-4abb-a84b-263e3585c916.sql
-- ------------------------------------------------------------


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


-- ------------------------------------------------------------
-- FILE: 20260630084600_e69791f7-13f2-496e-b1bc-ceb68474cb14.sql
-- ------------------------------------------------------------

ALTER TYPE public.expense_category ADD VALUE IF NOT EXISTS 'packing';

-- ------------------------------------------------------------
-- FILE: 20260701044857_b99c6413-7910-40a7-9b34-a78ae6f36c92.sql
-- ------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.assign_order_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE max_no int; max_rs int; is_rs boolean;
BEGIN
  IF NEW.status = 'draft' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' THEN
      NEW.order_no := '0';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'ready_stock' THEN
    -- Auto-assign RS-N when empty, '0', or plain integer (previous behavior)
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_rs
        FROM public.orders
        WHERE status = 'ready_stock'
          AND order_no ~ '^RS-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'RS-' || (max_rs + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  -- active/return
  is_rs := NEW.order_no ~* '^RS-';
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR is_rs THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE status NOT IN ('draft','ready_stock')
        AND order_no !~* '^RS-'
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260702095907_4d9a60a8-b4bb-4fbd-a912-6070bd930301.sql
-- ------------------------------------------------------------

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'lunas' CHECK (payment_status IN ('lunas','hutang'));

-- ------------------------------------------------------------
-- FILE: 20260704040641_82a2ed64-7166-4c28-b77b-d6c4c52f486e.sql
-- ------------------------------------------------------------


ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS workshop_lat double precision,
  ADD COLUMN IF NOT EXISTS workshop_lng double precision,
  ADD COLUMN IF NOT EXISTS radius_meters integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS enforce_location boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "authenticated read attendance settings meta" ON public.attendance_settings;
CREATE POLICY "authenticated read attendance settings meta"
  ON public.attendance_settings FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.attendance_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.get_permanent_attendance_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE s text; sig text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'Secret belum diinisialisasi'; END IF;
  sig := substr(encode(extensions.hmac('PERMANENT', s, 'sha256'), 'hex'), 1, 24);
  RETURN 'PRM:' || sig;
END $$;

CREATE OR REPLACE FUNCTION public.update_attendance_location(
  _lat double precision,
  _lng double precision,
  _radius integer,
  _enforce boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _radius IS NULL OR _radius < 10 THEN RAISE EXCEPTION 'Radius minimal 10 meter'; END IF;
  UPDATE public.attendance_settings
     SET workshop_lat = _lat,
         workshop_lng = _lng,
         radius_meters = _radius,
         enforce_location = COALESCE(_enforce, false),
         updated_at = now()
   WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO public.attendance_settings(id, workshop_lat, workshop_lng, radius_meters, enforce_location)
      VALUES (1, _lat, _lng, _radius, COALESCE(_enforce, false));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.attendance_check_in(text);
DROP FUNCTION IF EXISTS public.attendance_check_in(text, double precision, double precision);

CREATE OR REPLACE FUNCTION public.attendance_check_in(
  _token text,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid;
  now_ts timestamptz := now();
  today_date date := (now_ts AT TIME ZONE 'Asia/Jakarta')::date;
  rec record;
  action text;
  mins_since_last numeric;
  last_ts timestamptz;
  min_gap_min numeric := 10;
  daily_date text; daily_sig text; daily_expected text;
  perm_sig text; perm_expected text;
  ws_lat double precision; ws_lng double precision; ws_radius integer; ws_enforce boolean;
  d_meters double precision;
  rad_lat1 double precision; rad_lat2 double precision; rad_dlat double precision; rad_dlng double precision;
  a_h double precision;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret, workshop_lat, workshop_lng, radius_meters, enforce_location
    INTO s, ws_lat, ws_lng, ws_radius, ws_enforce
    FROM public.attendance_settings WHERE id = 1;

  IF COALESCE(ws_enforce, false) THEN
    IF ws_lat IS NULL OR ws_lng IS NULL THEN
      RAISE EXCEPTION 'Lokasi workshop belum diatur oleh admin';
    END IF;
    IF _lat IS NULL OR _lng IS NULL THEN
      RAISE EXCEPTION 'Izinkan akses lokasi pada perangkat Anda untuk melakukan absensi';
    END IF;
    rad_lat1 := radians(ws_lat);
    rad_lat2 := radians(_lat);
    rad_dlat := radians(_lat - ws_lat);
    rad_dlng := radians(_lng - ws_lng);
    a_h := sin(rad_dlat/2)^2 + cos(rad_lat1) * cos(rad_lat2) * sin(rad_dlng/2)^2;
    d_meters := 6371000 * 2 * atan2(sqrt(a_h), sqrt(1 - a_h));
    IF d_meters > ws_radius THEN
      RAISE EXCEPTION 'Anda berada % meter dari workshop (maks % meter). Silakan mendekat ke lokasi.', round(d_meters)::int, ws_radius;
    END IF;
  END IF;

  IF _token LIKE 'PRM:%' THEN
    perm_sig := split_part(_token, ':', 2);
    perm_expected := substr(encode(extensions.hmac('PERMANENT', s, 'sha256'), 'hex'), 1, 24);
    IF perm_sig IS NOT NULL AND perm_sig = perm_expected THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR permanen tidak valid';
    END IF;
  ELSIF _token LIKE 'DLY:%' THEN
    daily_date := split_part(_token, ':', 2);
    daily_sig  := split_part(_token, ':', 3);
    IF daily_date IS NULL OR length(daily_date) <> 8 OR daily_sig IS NULL OR length(daily_sig) <> 16 THEN
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
    IF daily_date <> to_char(today_date, 'YYYYMMDD') THEN
      RAISE EXCEPTION 'QR harian sudah kadaluarsa (hanya berlaku untuk tanggal %)', daily_date;
    END IF;
    daily_expected := substr(encode(extensions.hmac('DAILY:' || daily_date, s, 'sha256'), 'hex'), 1, 16);
    IF daily_expected = daily_sig THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
  ELSE
    win := floor(extract(epoch FROM now_ts) / 10)::bigint;
    FOR w IN win-1..win+1 LOOP
      expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
      IF expected = _token THEN is_valid := true; EXIT; END IF;
    END LOOP;
    IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;

  SELECT * INTO rec FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF rec.id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING * INTO rec;
    action := 'check_in';
  ELSIF rec.check_out IS NULL AND rec.break_start IS NULL THEN
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_in)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out';
  ELSIF rec.check_out IS NOT NULL AND rec.break_start IS NULL THEN
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_out)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances
      SET break_start = rec.check_out,
          break_end   = now_ts,
          check_out   = NULL
      WHERE id = rec.id;
    action := 'break_end';
  ELSIF rec.break_end IS NOT NULL AND rec.check_out IS NULL THEN
    last_ts := COALESCE(rec.break_end, rec.check_in);
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - last_ts)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out_final';
  ELSE
    RAISE EXCEPTION 'Anda sudah menyelesaikan absensi hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', rec.id, 'time', now_ts);
END $$;


-- ------------------------------------------------------------
-- FILE: 20260706063835_55553a90-e2a5-4289-99ea-e238a614ea53.sql
-- ------------------------------------------------------------


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


-- ------------------------------------------------------------
-- FILE: 20260706064920_70dc8daa-b5a7-4d57-9063-4d74b2d827c9.sql
-- ------------------------------------------------------------


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


-- ------------------------------------------------------------
-- FILE: 20260707074840_3ff3c966-c57c-4a3f-ab95-ead93e21d5c3.sql
-- ------------------------------------------------------------


-- 1) Add parent_order_id to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_parent_order_id ON public.projects(parent_order_id);

-- 2) Enum & table
DO $$ BEGIN
  CREATE TYPE public.order_item_kind AS ENUM ('custom','ready_stock_ref','ready_stock_manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 1,
  kind public.order_item_kind NOT NULL DEFAULT 'custom',

  -- custom fields
  text_neon text,
  akrilik_p numeric NOT NULL DEFAULT 0,
  akrilik_l numeric NOT NULL DEFAULT 0,
  led_meter numeric NOT NULL DEFAULT 0,
  titik int NOT NULL DEFAULT 0,
  kabel_meter numeric,
  kabel_socket_meter numeric NOT NULL DEFAULT 1,
  adaptor numeric NOT NULL DEFAULT 0,
  adaptor_type text,
  modul numeric NOT NULL DEFAULT 0,
  socket_dc numeric NOT NULL DEFAULT 0,
  baut_fischer numeric NOT NULL DEFAULT 0,
  outdoor_cost numeric,

  -- computed
  led_cost numeric NOT NULL DEFAULT 0,
  akrilik_cost numeric NOT NULL DEFAULT 0,
  solder_cost numeric NOT NULL DEFAULT 0,
  tempel_cost numeric NOT NULL DEFAULT 0,
  kabel_cost numeric NOT NULL DEFAULT 0,
  kabel_socket_cost numeric NOT NULL DEFAULT 0,
  biaya_lainnya numeric NOT NULL DEFAULT 0,
  item_hpp numeric NOT NULL DEFAULT 0,

  -- ready-stock ref
  source_ready_stock_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,

  -- ready-stock manual
  manual_name text,
  manual_price numeric NOT NULL DEFAULT 0,
  manual_hpp numeric NOT NULL DEFAULT 0,

  -- project link (for custom)
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_project_id ON public.order_items(project_id);
CREATE INDEX IF NOT EXISTS idx_order_items_source_rs ON public.order_items(source_ready_stock_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view order items" ON public.order_items;
CREATE POLICY "Staff can view order items" ON public.order_items
  FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));
DROP POLICY IF EXISTS "Staff can write order items" ON public.order_items;
CREATE POLICY "Staff can write order items" ON public.order_items
  FOR ALL TO authenticated USING (public.is_admin_or_owner(auth.uid()))
  WITH CHECK (public.is_admin_or_owner(auth.uid()));

-- 3) Per-item cost calculator (mirrors calc_order_costs)
CREATE OR REPLACE FUNCTION public.calc_order_item_costs()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  IF NEW.kind = 'ready_stock_manual' THEN
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(NEW.manual_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.kind = 'ready_stock_ref' THEN
    -- HPP taken from referenced order
    SELECT COALESCE(o.hpp, 0) INTO base_hpp
      FROM public.orders o WHERE o.id = NEW.source_ready_stock_order_id;
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(base_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- kind = custom
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';

  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;

  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));

  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.item_hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0);
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS calc_order_item_costs_trg ON public.order_items;
CREATE TRIGGER calc_order_item_costs_trg
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.calc_order_item_costs();

-- 4) Aggregator: recompute order header from items
CREATE OR REPLACE FUNCTION public.refresh_order_from_items(_oid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  cnt int; sum_hpp numeric; sum_titik int; sum_led numeric; combined text;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(item_hpp), 0),
    COALESCE(SUM(titik), 0),
    COALESCE(SUM(led_meter), 0),
    string_agg(
      COALESCE(NULLIF(text_neon,''), NULLIF(manual_name,''), 'Item'),
      ' | ' ORDER BY position
    )
  INTO cnt, sum_hpp, sum_titik, sum_led, combined
  FROM public.order_items WHERE order_id = _oid;

  IF cnt = 0 THEN RETURN; END IF;

  UPDATE public.orders
    SET hpp = sum_hpp + COALESCE(repair_cost,0),
        titik = sum_titik,
        led_meter = sum_led,
        text_neon = COALESCE(NULLIF(combined,''), text_neon),
        profit = COALESCE(payment,0) + COALESCE(split,0) - (sum_hpp + COALESCE(repair_cost,0)),
        updated_at = now()
    WHERE id = _oid;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_refresh_order_from_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.refresh_order_from_items(COALESCE(NEW.order_id, OLD.order_id));
  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS order_items_aggregate ON public.order_items;
CREATE TRIGGER order_items_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_order_from_items();

-- 5) Adjust calc_order_costs to skip cost recomputation when items exist
CREATE OR REPLACE FUNCTION public.calc_order_costs()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric; item_count int := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  END IF;

  IF item_count > 0 THEN
    -- Items-driven: profit derived from existing hpp (aggregated) + repair
    NEW.hpp := (SELECT COALESCE(SUM(item_hpp),0) FROM public.order_items WHERE order_id = NEW.id)
               + COALESCE(NEW.repair_cost,0);
    NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Legacy path (order without items): original logic
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0) + COALESCE(NEW.repair_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- 6) Sync per-item to Project (custom items only)
CREATE OR REPLACE FUNCTION public.sync_item_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid; proj_code text;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
BEGIN
  IF NEW.kind <> 'custom' THEN
    -- if switched away from custom, detach any previously linked project
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  proj_code := COALESCE(NULLIF(ord.order_no,''),'ORD') || '-' || NEW.position::text;
  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  -- proportional contract value based on item HPP share
  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET code = proj_code,
          title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id)
      VALUES (proj_code,
              COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
              cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects
        SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            customer_id = cust_id,
            total_points = GREATEST(NEW.titik,0),
            contract_value = contract_val,
            parent_order_id = ord.id
        WHERE id = proj_id;
    END IF;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS sync_item_to_project_trg ON public.order_items;
CREATE TRIGGER sync_item_to_project_trg
  AFTER INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_item_to_project();

-- 7) Bypass legacy sync_order_to_project when order has items
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; proj_code text; has_logs boolean; item_count int;
BEGIN
  SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  IF item_count > 0 THEN
    RETURN NEW;  -- managed by sync_item_to_project
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN DELETE FROM public.projects WHERE id = proj_id; END IF;
    END IF;
    RETURN NEW;
  END IF;

  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active', NEW.id)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 8) Backfill: 1 order lama -> 1 order_items
INSERT INTO public.order_items
  (order_id, position, kind, text_neon, akrilik_p, akrilik_l, led_meter, titik,
   kabel_meter, kabel_socket_meter, adaptor, adaptor_type, modul, socket_dc, baut_fischer,
   outdoor_cost, notes, project_id)
SELECT o.id, 1, 'custom', o.text_neon, o.akrilik_p, o.akrilik_l, o.led_meter, o.titik,
       o.kabel_meter, o.kabel_socket_meter, o.adaptor, o.adaptor_type, o.modul, o.socket_dc, o.baut_fischer,
       o.outdoor_cost, o.notes, o.project_id
FROM public.orders o
WHERE NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id = o.id);

-- Link projects to their parent orders (backfill)
UPDATE public.projects p
   SET parent_order_id = o.id
  FROM public.orders o
 WHERE o.project_id = p.id AND p.parent_order_id IS NULL;


-- ------------------------------------------------------------
-- FILE: 20260708021741_7affb539-a058-41b2-a51e-81b4042af3c5.sql
-- ------------------------------------------------------------

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'kurir';

-- ------------------------------------------------------------
-- FILE: 20260708021831_fe45c927-f28b-4c14-90ca-d7bc13da59b9.sql
-- ------------------------------------------------------------


-- 1) Fix duplicate project
CREATE OR REPLACE FUNCTION public.sync_item_to_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid; proj_code text;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
  header_proj_id uuid; header_has_logs boolean;
BEGIN
  IF NEW.kind <> 'custom' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO header_proj_id
    FROM public.projects
    WHERE parent_order_id = ord.id
      AND code = ord.order_no
    LIMIT 1;
  IF header_proj_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = header_proj_id) INTO header_has_logs;
    IF NOT header_has_logs THEN
      IF ord.project_id = header_proj_id THEN
        UPDATE public.orders SET project_id = NULL WHERE id = ord.id;
      END IF;
      DELETE FROM public.projects WHERE id = header_proj_id;
    END IF;
  END IF;

  proj_code := COALESCE(NULLIF(ord.order_no,''),'ORD') || '-' || NEW.position::text;
  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET code = proj_code,
          title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id)
      VALUES (proj_code,
              COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
              cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects
        SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            customer_id = cust_id,
            total_points = GREATEST(NEW.titik,0),
            contract_value = contract_val,
            parent_order_id = ord.id
        WHERE id = proj_id;
    END IF;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 1b) Cleanup existing duplicates
DELETE FROM public.projects p
WHERE p.parent_order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = p.parent_order_id AND o.order_no = p.code
  )
  AND EXISTS (
    SELECT 1 FROM public.projects p2
     WHERE p2.parent_order_id = p.parent_order_id
       AND p2.id <> p.id
       AND p2.code LIKE p.code || '-%'
  )
  AND NOT EXISTS (SELECT 1 FROM public.job_logs jl WHERE jl.project_id = p.id);

-- 2) Shipment columns on orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS no_resi text,
  ADD COLUMN IF NOT EXISTS ekspedisi text,
  ADD COLUMN IF NOT EXISTS ready_pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_no_resi_idx ON public.orders (no_resi);
CREATE INDEX IF NOT EXISTS orders_ready_pickup_idx ON public.orders (ready_pickup_at) WHERE picked_up_at IS NULL;

-- 3) shipment_events table
CREATE TABLE IF NOT EXISTS public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('ready_pickup','picked_up')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.shipment_events TO authenticated;
GRANT ALL ON public.shipment_events TO service_role;

ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view all shipment_events" ON public.shipment_events;
CREATE POLICY "Staff can view all shipment_events"
  ON public.shipment_events FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()) OR public.has_role(auth.uid(),'kurir') OR actor_id = auth.uid());

DROP POLICY IF EXISTS "Staff or actor can insert shipment_events" ON public.shipment_events;
CREATE POLICY "Staff or actor can insert shipment_events"
  ON public.shipment_events FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner(auth.uid()) OR actor_id = auth.uid());

-- 4) Orders policy for kurir
DROP POLICY IF EXISTS "Kurir can view pickup-ready orders" ON public.orders;
CREATE POLICY "Kurir can view pickup-ready orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'kurir') AND (
      (ready_pickup_at IS NOT NULL AND picked_up_at IS NULL)
      OR picked_up_by = auth.uid()
    )
  );

-- 5) Functions
CREATE OR REPLACE FUNCTION public.mark_ready_pickup(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF COALESCE(ord.no_resi,'') = '' THEN RAISE EXCEPTION 'No Resi belum diisi'; END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()),
        updated_at = now()
    WHERE id = _order_id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (_order_id, 'ready_pickup', auth.uid(), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.courier_pickup(_no_resi text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(),'kurir') AND NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya kurir';
  END IF;
  IF _no_resi IS NULL OR btrim(_no_resi) = '' THEN
    RAISE EXCEPTION 'No Resi wajib diisi';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = btrim(_no_resi) LIMIT 1;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Resi tidak ditemukan'; END IF;
  IF ord.ready_pickup_at IS NULL THEN
    RAISE EXCEPTION 'Paket belum ditandai siap pickup oleh admin';
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET picked_up_at = now(), picked_up_by = auth.uid(), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'picked_up', auth.uid(), _note);
  RETURN jsonb_build_object('order_id', ord.id, 'order_no', ord.order_no, 'ekspedisi', ord.ekspedisi);
END $$;


-- ------------------------------------------------------------
-- FILE: 20260708025020_b5aba9e9-7c02-4a4c-8cd9-f7c3ff957362.sql
-- ------------------------------------------------------------


CREATE TABLE public.shipping_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shipping_carriers TO authenticated;
GRANT ALL ON public.shipping_carriers TO service_role;
ALTER TABLE public.shipping_carriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read carriers" ON public.shipping_carriers FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage carriers" ON public.shipping_carriers FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER trg_shipping_carriers_updated
  BEFORE UPDATE ON public.shipping_carriers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.shipping_carriers(name, sort_order) VALUES
  ('JNE', 10), ('J&T', 20), ('SiCepat', 30), ('Anteraja', 40),
  ('Ninja', 50), ('Pos Indonesia', 60), ('ID Express', 70),
  ('Lion Parcel', 80), ('GoSend', 90), ('Grab Express', 100),
  ('Lainnya', 999)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD; resi text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  resi := btrim(COALESCE(_no_resi,''));
  IF resi = '' THEN RAISE EXCEPTION 'No Resi wajib diisi'; END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = resi LIMIT 1;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Resi % tidak ditemukan di data order', resi;
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil kurir pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'ready_pickup', auth.uid(), NULL);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $$;


-- ------------------------------------------------------------
-- FILE: 20260710125507_bcc69551-3e6a-4c2e-8a82-ec429335afe8.sql
-- ------------------------------------------------------------


-- 1. Add draft_ref to enum
ALTER TYPE public.order_item_kind ADD VALUE IF NOT EXISTS 'draft_ref';

-- 2. Add column for referencing draft
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS source_draft_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_source_draft ON public.order_items(source_draft_order_id) WHERE source_draft_order_id IS NOT NULL;

-- 3. Update assign_order_no to handle DR-N for drafts
CREATE OR REPLACE FUNCTION public.assign_order_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE max_no int; max_rs int; max_dr int; is_rs boolean; is_dr boolean;
BEGIN
  IF NEW.status = 'draft' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR NOT (NEW.order_no ~* '^DR-\d+$') THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_dr
        FROM public.orders
        WHERE status = 'draft'
          AND order_no ~ '^DR-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'DR-' || (max_dr + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'ready_stock' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_rs
        FROM public.orders
        WHERE status = 'ready_stock'
          AND order_no ~ '^RS-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'RS-' || (max_rs + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  -- active/return
  is_rs := NEW.order_no ~* '^RS-';
  is_dr := NEW.order_no ~* '^DR-';
  -- allow order_no like "<parent>-Dx" to pass through (absorbed drafts)
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR is_rs OR is_dr THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE status NOT IN ('draft','ready_stock')
        AND order_no !~* '^RS-'
        AND order_no !~* '^DR-'
        AND order_no !~ '-D\d+$'
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $function$;

-- 4. Extend calc_order_item_costs for draft_ref
CREATE OR REPLACE FUNCTION public.calc_order_item_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  IF NEW.kind = 'ready_stock_manual' THEN
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(NEW.manual_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.kind = 'ready_stock_ref' THEN
    SELECT COALESCE(o.hpp, 0) INTO base_hpp
      FROM public.orders o WHERE o.id = NEW.source_ready_stock_order_id;
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(base_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.kind = 'draft_ref' THEN
    SELECT COALESCE(o.hpp, 0) INTO base_hpp
      FROM public.orders o WHERE o.id = NEW.source_draft_order_id;
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(base_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- kind = custom
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';

  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;

  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));

  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.item_hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0);
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- 5. Trigger to absorb / release referenced draft
CREATE OR REPLACE FUNCTION public.absorb_referenced_draft()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  parent RECORD;
  draft_ord RECORD;
  new_no text;
  max_dr int;
  released_id uuid;
BEGIN
  -- Handle DELETE or unlink on UPDATE: release old draft
  IF (TG_OP = 'DELETE') OR
     (TG_OP = 'UPDATE' AND (OLD.kind = 'draft_ref') AND
       (NEW.kind <> 'draft_ref' OR NEW.source_draft_order_id IS DISTINCT FROM OLD.source_draft_order_id))
  THEN
    released_id := OLD.source_draft_order_id;
    IF released_id IS NOT NULL THEN
      -- Only revert if this order really was the absorber
      IF EXISTS (SELECT 1 FROM public.orders WHERE id = released_id AND parent_order_id = OLD.order_id) THEN
        SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
          INTO max_dr
          FROM public.orders
          WHERE status = 'draft' AND order_no ~ '^DR-\d+$';
        UPDATE public.orders
          SET status = 'draft',
              order_no = 'DR-' || (max_dr + 1)::text,
              parent_order_id = NULL,
              updated_at = now()
          WHERE id = released_id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Absorb on INSERT/UPDATE where kind=draft_ref
  IF NEW.kind = 'draft_ref' AND NEW.source_draft_order_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.orders WHERE id = NEW.order_id;
    IF parent.id IS NOT NULL AND parent.status IN ('active','return','ready_stock') THEN
      SELECT * INTO draft_ord FROM public.orders WHERE id = NEW.source_draft_order_id;
      IF draft_ord.id IS NOT NULL AND draft_ord.status = 'draft' THEN
        new_no := COALESCE(NULLIF(parent.order_no,''),'ORD') || '-D' || NEW.position::text;
        UPDATE public.orders
          SET status = parent.status,
              order_no = new_no,
              parent_order_id = parent.id,
              updated_at = now()
          WHERE id = draft_ord.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_absorb_referenced_draft ON public.order_items;
CREATE TRIGGER trg_absorb_referenced_draft
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.absorb_referenced_draft();

-- 6. Backfill existing drafts that still use order_no '0' or plain integers
DO $$
DECLARE r RECORD; n int := 0; max_dr int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
    INTO max_dr FROM public.orders WHERE status='draft' AND order_no ~ '^DR-\d+$';
  n := max_dr;
  FOR r IN
    SELECT id FROM public.orders
    WHERE status = 'draft' AND (order_no IS NULL OR order_no = '' OR order_no = '0' OR NOT (order_no ~* '^DR-\d+$'))
    ORDER BY created_at
  LOOP
    n := n + 1;
    UPDATE public.orders SET order_no = 'DR-' || n::text WHERE id = r.id;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- FILE: 20260713090320_84baaf99-c0df-444f-8c1d-ebd29affbb15.sql
-- ------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.close_projects_for_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT project_id FROM public.orders WHERE id = _order_id AND project_id IS NOT NULL
        UNION
        SELECT project_id FROM public.order_items WHERE order_id = _order_id AND project_id IS NOT NULL
      );
END $$;

CREATE OR REPLACE FUNCTION public.mark_ready_pickup(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF COALESCE(ord.no_resi,'') = '' THEN RAISE EXCEPTION 'No Resi belum diisi'; END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()),
        updated_at = now()
    WHERE id = _order_id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (_order_id, 'ready_pickup', auth.uid(), NULL);
  PERFORM public.close_projects_for_order(_order_id);
END $$;

CREATE OR REPLACE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD; resi text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  resi := btrim(COALESCE(_no_resi,''));
  IF resi = '' THEN RAISE EXCEPTION 'No Resi wajib diisi'; END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = resi LIMIT 1;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Resi % tidak ditemukan di data order', resi;
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil kurir pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'ready_pickup', auth.uid(), NULL);
  PERFORM public.close_projects_for_order(ord.id);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $$;


-- ------------------------------------------------------------
-- FILE: 20260714071602_1b67744a-a3c1-4690-9cca-a4b9763abbf4.sql
-- ------------------------------------------------------------


-- Remove auto-close on pickup
CREATE OR REPLACE FUNCTION public.mark_ready_pickup(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ord RECORD;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF COALESCE(ord.no_resi,'') = '' THEN RAISE EXCEPTION 'No Resi belum diisi'; END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()),
        updated_at = now()
    WHERE id = _order_id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (_order_id, 'ready_pickup', auth.uid(), NULL);
END $function$;

CREATE OR REPLACE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ord RECORD; resi text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  resi := btrim(COALESCE(_no_resi,''));
  IF resi = '' THEN RAISE EXCEPTION 'No Resi wajib diisi'; END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = resi LIMIT 1;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Resi % tidak ditemukan di data order', resi;
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil kurir pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'ready_pickup', auth.uid(), NULL);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $function$;

-- Scheduled closer: close projects for orders whose ready_pickup_at is >= 48h ago
CREATE OR REPLACE FUNCTION public.close_projects_after_pickup_delay()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT o.project_id FROM public.orders o
          WHERE o.ready_pickup_at IS NOT NULL
            AND o.ready_pickup_at <= now() - interval '48 hours'
            AND o.project_id IS NOT NULL
        UNION
        SELECT oi.project_id FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          WHERE o.ready_pickup_at IS NOT NULL
            AND o.ready_pickup_at <= now() - interval '48 hours'
            AND oi.project_id IS NOT NULL
      );
END $function$;



-- [DINONAKTIFKAN untuk Supabase sendiri] Penjadwal pg_cron berikut menunjuk
-- alamat Lovable / memerlukan ekstensi pg_cron & pg_net. Gunakan Vercel Cron
-- sebagai gantinya (DEPLOY.md). Bila ingin tetap memakai pg_cron: aktifkan
-- ekstensi pg_cron dan pg_net di Dashboard > Database > Extensions, ganti URL
-- dan apikey di bawah dengan milik Anda, lalu hapus tanda komentar.

-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-projects-after-pickup-delay') THEN
--     PERFORM cron.unschedule('close-projects-after-pickup-delay');
--   END IF;
-- END $$;
--
-- SELECT cron.schedule(
--   'close-projects-after-pickup-delay',
--   '0 * * * *',
--   $$ SELECT public.close_projects_after_pickup_delay(); $$
-- );

-- ------------------------------------------------------------
-- FILE: 20260714085336_dd5854eb-8d31-44e3-a30e-1b82a4ff4144.sql
-- ------------------------------------------------------------


ALTER TABLE public.job_rates
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'per_unit',
  ADD COLUMN IF NOT EXISTS min_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.job_rates
  DROP CONSTRAINT IF EXISTS job_rates_pricing_mode_check;
ALTER TABLE public.job_rates
  ADD CONSTRAINT job_rates_pricing_mode_check CHECK (pricing_mode IN ('per_unit','area'));

CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r numeric; m numeric; mode text; base numeric;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit')
    INTO r, m, mode
    FROM public.job_rates WHERE id = NEW.rate_id;
  base := COALESCE(r,0) * NEW.qty;
  IF mode = 'area' THEN
    NEW.amount := GREATEST(base, m);
  ELSE
    IF m > 0 THEN
      NEW.amount := GREATEST(base, m);
    ELSE
      NEW.amount := base;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE total int; claimed numeric; mode text;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(pricing_mode,'per_unit') INTO mode FROM public.job_rates WHERE id = NEW.rate_id;
  IF mode = 'area' THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND rate_id = NEW.rate_id
      AND status <> 'rejected'
      AND COALESCE(is_repair,false) = false
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260715083821_329bbad2-6987-4a9c-ae69-accdc5c888b6.sql
-- ------------------------------------------------------------


-- 1) Single-claim enforcement for area-based rates (per project)
CREATE OR REPLACE FUNCTION public.enforce_single_area_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE mode text; existing_emp uuid; existing_name text;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  SELECT COALESCE(pricing_mode,'per_unit') INTO mode FROM public.job_rates WHERE id = NEW.rate_id;
  IF mode <> 'area' THEN RETURN NEW; END IF;
  SELECT jl.employee_id INTO existing_emp
    FROM public.job_logs jl
    WHERE jl.project_id = NEW.project_id
      AND jl.rate_id = NEW.rate_id
      AND jl.status <> 'rejected'
      AND COALESCE(jl.is_repair,false) = false
      AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
    LIMIT 1;
  IF existing_emp IS NOT NULL AND existing_emp <> NEW.employee_id THEN
    SELECT full_name INTO existing_name FROM public.employees WHERE id = existing_emp;
    RAISE EXCEPTION 'Jenis garapan ini sudah diklaim oleh % pada project ini. Hanya 1 karyawan yang boleh mengklaim.', COALESCE(existing_name, 'karyawan lain');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_single_area_claim ON public.job_logs;
CREATE TRIGGER trg_enforce_single_area_claim
BEFORE INSERT OR UPDATE ON public.job_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_area_claim();


-- 2) Pipeline status RPC for Status page (accessible to any logged-in user)
CREATE OR REPLACE FUNCTION public.get_active_pipeline()
RETURNS TABLE(
  project_id uuid,
  project_code text,
  project_title text,
  customer_name text,
  total_points int,
  order_id uuid,
  order_no text,
  order_status text,
  co_date date,
  ekspedisi text,
  no_resi text,
  ready_pickup_at timestamptz,
  picked_up_at timestamptz,
  has_cut boolean,
  has_potong boolean,
  has_solder boolean,
  has_kabel boolean,
  has_tempel boolean,
  cut_qty numeric,
  potong_qty numeric,
  solder_qty numeric,
  kabel_qty numeric,
  tempel_qty numeric,
  current_step text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  agg AS (
    SELECT
      p.id AS project_id,
      p.code AS project_code,
      p.title AS project_title,
      c.name AS customer_name,
      p.total_points,
      o.id AS order_id,
      o.order_no,
      o.status::text AS order_status,
      o.co_date,
      o.ekspedisi,
      o.no_resi,
      o.ready_pickup_at,
      o.picked_up_at,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_tempel THEN 'tempel'
      WHEN has_kabel THEN 'kabel'
      WHEN has_solder THEN 'solder'
      WHEN has_potong THEN 'potong'
      WHEN has_cut THEN 'cutting'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY co_date DESC NULLS LAST, project_code DESC;
$$;

REVOKE ALL ON FUNCTION public.get_active_pipeline() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_pipeline() TO authenticated;


-- 3) Detail RPC (hides phone from non-admin/owner)
CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', o.akrilik_p, 'akrilik_l', o.akrilik_l,
      'led_meter', o.led_meter, 'titik', o.titik,
      'notes', o.notes
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  WHERE p.id = _project_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_project_detail_for_worker(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_detail_for_worker(uuid) TO authenticated;


-- ------------------------------------------------------------
-- FILE: 20260715090523_f7e2b57a-cb9d-4eeb-830f-67667703347a.sql
-- ------------------------------------------------------------


DROP FUNCTION IF EXISTS public.get_active_pipeline();

CREATE OR REPLACE FUNCTION public.get_active_pipeline()
 RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_kabel THEN 'packing'
      WHEN has_tempel THEN 'kabel'
      WHEN has_solder THEN 'tempel'
      WHEN has_potong THEN 'solder'
      WHEN has_cut THEN 'potong'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY
    CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
    deadline ASC,
    co_date DESC NULLS LAST,
    project_code DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', o.akrilik_p, 'akrilik_l', o.akrilik_l,
      'led_meter', o.led_meter, 'titik', o.titik,
      'kabel_meter', o.kabel_meter,
      'kabel_socket_meter', o.kabel_socket_meter,
      'notes', o.notes
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  WHERE p.id = _project_id;
  RETURN result;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260715133141_b5239979-ab67-42d4-85ad-9a1de7fb0b08.sql
-- ------------------------------------------------------------

ALTER TABLE public.job_rates
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r numeric;
  m numeric;
  mode text;
  base numeric;
  area_qty numeric;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit')
    INTO r, m, mode
    FROM public.job_rates
    WHERE id = NEW.rate_id;

  IF mode = 'area' AND NEW.project_id IS NOT NULL AND COALESCE(NEW.is_repair, false) = false THEN
    SELECT COALESCE(NULLIF(o.akrilik_p, 0), NULLIF(oi.akrilik_p, 0), 0)
         * COALESCE(NULLIF(o.akrilik_l, 0), NULLIF(oi.akrilik_l, 0), 0)
      INTO area_qty
      FROM public.projects p
      LEFT JOIN public.orders o ON o.id = p.parent_order_id
      LEFT JOIN LATERAL (
        SELECT akrilik_p, akrilik_l
        FROM public.order_items
        WHERE order_id = p.parent_order_id
          AND COALESCE(akrilik_p, 0) > 0
          AND COALESCE(akrilik_l, 0) > 0
        ORDER BY position NULLS LAST, created_at ASC
        LIMIT 1
      ) oi ON true
      WHERE p.id = NEW.project_id;

    IF area_qty IS NULL OR area_qty <= 0 THEN
      RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
    END IF;

    NEW.qty := area_qty;
  END IF;

  base := COALESCE(r,0) * COALESCE(NEW.qty,0);
  NEW.amount := CASE WHEN m > 0 THEN GREATEST(base, m) ELSE base END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  total int;
  claimed numeric;
  mode text;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit') INTO mode
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode = 'area' THEN RETURN NEW; END IF;

  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(qty), 0) INTO claimed
  FROM public.job_logs
  WHERE project_id = NEW.project_id
    AND rate_id = NEW.rate_id
    AND status <> 'rejected'
    AND COALESCE(is_repair,false) = false
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_single_area_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  mode text;
  existing_emp uuid;
  existing_name text;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit') INTO mode
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode <> 'area' THEN RETURN NEW; END IF;

  SELECT jl.employee_id INTO existing_emp
  FROM public.job_logs jl
  WHERE jl.project_id = NEW.project_id
    AND jl.rate_id = NEW.rate_id
    AND jl.status <> 'rejected'
    AND COALESCE(jl.is_repair,false) = false
    AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
  LIMIT 1;

  IF existing_emp IS NOT NULL THEN
    SELECT full_name INTO existing_name FROM public.employees WHERE id = existing_emp;
    RAISE EXCEPTION 'Jenis garapan ini sudah diklaim oleh % pada project ini. Hanya 1 karyawan yang boleh mengklaim.', COALESCE(existing_name, 'karyawan lain');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_single_area_claim ON public.job_logs;
CREATE TRIGGER trg_enforce_single_area_claim
BEFORE INSERT OR UPDATE ON public.job_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_area_claim();

CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
RETURNS TABLE(
  rate_id uuid,
  rate_name text,
  unit text,
  rate_per_unit numeric,
  total_points integer,
  claimed_points numeric,
  remaining_points numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    r.id,
    r.name,
    r.unit,
    r.rate_per_unit,
    CASE WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN 1 ELSE p.total_points END AS total_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
      ELSE COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0)
    END AS claimed_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
      ELSE GREATEST(p.total_points - COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0), 0)
    END AS remaining_points
  FROM public.projects p
  CROSS JOIN public.job_rates r
  WHERE p.id = _project_id
    AND r.active = true
  ORDER BY r.sort_order ASC, r.name ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_project_rate_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(
  id uuid,
  code text,
  title text,
  status project_status,
  total_points integer,
  claimed_points numeric,
  remaining_points numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id, COALESCE(pricing_mode,'per_unit') AS pricing_mode
    FROM public.job_rates
    WHERE active = true
  ), project_availability AS (
    SELECT
      p.id,
      p.code,
      p.title,
      p.status,
      COALESCE(SUM(CASE WHEN ar.pricing_mode = 'area' THEN 1 ELSE p.total_points END), 0)::integer AS total_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 1 ELSE 0 END
        ELSE LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)
      END), 0) AS claimed_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 0 ELSE 1 END
        ELSE GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)
      END), 0) AS remaining_points,
      p.created_at
    FROM public.projects p
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty, COUNT(*) > 0 AS has_claim
      FROM public.job_logs jl
      WHERE jl.project_id = p.id
        AND jl.rate_id = ar.id
        AND jl.status <> 'rejected'
        AND COALESCE(jl.is_repair,false) = false
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points
  FROM project_availability
  ORDER BY created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260716075840_3239797a-187b-4497-abc3-34f9f4d88162.sql
-- ------------------------------------------------------------


CREATE TABLE IF NOT EXISTS public.user_feature_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, feature_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_feature_permissions TO authenticated;
GRANT ALL ON public.user_feature_permissions TO service_role;

ALTER TABLE public.user_feature_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feature perms"
  ON public.user_feature_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners manage feature perms"
  ON public.user_feature_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER update_user_feature_permissions_updated_at
  BEFORE UPDATE ON public.user_feature_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ------------------------------------------------------------
-- FILE: 20260716082637_7b9e269d-a98c-4f9f-96ab-c48d985ab2b0.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ord RECORD; resi text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Harus login';
  END IF;
  resi := btrim(COALESCE(_no_resi,''));
  IF resi = '' THEN RAISE EXCEPTION 'No Resi wajib diisi'; END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = resi LIMIT 1;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Resi % tidak ditemukan di data order', resi;
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil kurir pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'ready_pickup', auth.uid(), NULL);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $function$;

-- ------------------------------------------------------------
-- FILE: 20260718063910_24ec5a95-ee87-498d-bae1-6b5d6aea0bcc.sql
-- ------------------------------------------------------------


-- 1) Add area_scope to job_rates
ALTER TABLE public.job_rates
  ADD COLUMN IF NOT EXISTS area_scope text NOT NULL DEFAULT 'project'
  CHECK (area_scope IN ('project','order'));

-- 2) calc_job_log_amount: order-scope area sums all items on the parent order
CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r numeric;
  m numeric;
  mode text;
  scope text;
  base numeric;
  area_qty numeric;
  parent_oid uuid;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit'), COALESCE(area_scope,'project')
    INTO r, m, mode, scope
    FROM public.job_rates
    WHERE id = NEW.rate_id;

  IF mode = 'area' AND NEW.project_id IS NOT NULL AND COALESCE(NEW.is_repair, false) = false THEN
    IF scope = 'order' THEN
      SELECT p.parent_order_id INTO parent_oid FROM public.projects p WHERE p.id = NEW.project_id;
      IF parent_oid IS NULL THEN
        RAISE EXCEPTION 'Project belum terhubung ke order, tidak bisa menghitung total area order.';
      END IF;
      -- Sum area across all items with dimensions; fallback to order header
      SELECT COALESCE(SUM(COALESCE(NULLIF(oi.akrilik_p,0),0) * COALESCE(NULLIF(oi.akrilik_l,0),0)), 0)
        INTO area_qty
        FROM public.order_items oi
        WHERE oi.order_id = parent_oid;
      IF area_qty IS NULL OR area_qty <= 0 THEN
        SELECT COALESCE(o.akrilik_p,0) * COALESCE(o.akrilik_l,0) INTO area_qty
          FROM public.orders o WHERE o.id = parent_oid;
      END IF;
      IF area_qty IS NULL OR area_qty <= 0 THEN
        RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
      END IF;
      NEW.qty := area_qty;
    ELSE
      SELECT COALESCE(NULLIF(o.akrilik_p, 0), NULLIF(oi.akrilik_p, 0), 0)
           * COALESCE(NULLIF(o.akrilik_l, 0), NULLIF(oi.akrilik_l, 0), 0)
        INTO area_qty
        FROM public.projects p
        LEFT JOIN public.orders o ON o.id = p.parent_order_id
        LEFT JOIN LATERAL (
          SELECT akrilik_p, akrilik_l
          FROM public.order_items
          WHERE order_id = p.parent_order_id
            AND COALESCE(akrilik_p, 0) > 0
            AND COALESCE(akrilik_l, 0) > 0
          ORDER BY position NULLS LAST, created_at ASC
          LIMIT 1
        ) oi ON true
        WHERE p.id = NEW.project_id;

      IF area_qty IS NULL OR area_qty <= 0 THEN
        RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
      END IF;
      NEW.qty := area_qty;
    END IF;
  END IF;

  base := COALESCE(r,0) * COALESCE(NEW.qty,0);
  NEW.amount := CASE WHEN m > 0 THEN GREATEST(base, m) ELSE base END;
  RETURN NEW;
END;
$function$;

-- 3) enforce_single_area_claim: for order-scope, block if any project of same parent order has claim
CREATE OR REPLACE FUNCTION public.enforce_single_area_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  mode text;
  scope text;
  existing_emp uuid;
  existing_name text;
  parent_oid uuid;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit'), COALESCE(area_scope,'project')
    INTO mode, scope
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode <> 'area' THEN RETURN NEW; END IF;

  IF scope = 'order' THEN
    SELECT parent_order_id INTO parent_oid FROM public.projects WHERE id = NEW.project_id;
    IF parent_oid IS NOT NULL THEN
      SELECT jl.employee_id INTO existing_emp
      FROM public.job_logs jl
      JOIN public.projects p ON p.id = jl.project_id
      WHERE p.parent_order_id = parent_oid
        AND jl.rate_id = NEW.rate_id
        AND jl.status <> 'rejected'
        AND COALESCE(jl.is_repair,false) = false
        AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
      LIMIT 1;
    ELSE
      existing_emp := NULL;
    END IF;
  ELSE
    SELECT jl.employee_id INTO existing_emp
    FROM public.job_logs jl
    WHERE jl.project_id = NEW.project_id
      AND jl.rate_id = NEW.rate_id
      AND jl.status <> 'rejected'
      AND COALESCE(jl.is_repair,false) = false
      AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
    LIMIT 1;
  END IF;

  IF existing_emp IS NOT NULL THEN
    SELECT full_name INTO existing_name FROM public.employees WHERE id = existing_emp;
    RAISE EXCEPTION 'Jenis garapan ini sudah diklaim oleh % pada order ini. Hanya 1 karyawan yang boleh mengklaim.', COALESCE(existing_name, 'karyawan lain');
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) get_project_rate_availability: for order-scope area, availability is per parent order
CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
 RETURNS TABLE(rate_id uuid, rate_name text, unit text, rate_per_unit numeric, total_points integer, claimed_points numeric, remaining_points numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH proj AS (
    SELECT id, total_points, parent_order_id FROM public.projects WHERE id = _project_id
  )
  SELECT
    r.id,
    r.name,
    r.unit,
    r.rate_per_unit,
    CASE WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN 1 ELSE p.total_points END AS total_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' AND COALESCE(r.area_scope,'project') = 'order' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          JOIN public.projects p2 ON p2.id = jl.project_id
          WHERE p2.parent_order_id = p.parent_order_id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
      ELSE COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0)
    END AS claimed_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' AND COALESCE(r.area_scope,'project') = 'order' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          JOIN public.projects p2 ON p2.id = jl.project_id
          WHERE p2.parent_order_id = p.parent_order_id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
      ELSE GREATEST(p.total_points - COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0), 0)
    END AS remaining_points
  FROM proj p
  CROSS JOIN public.job_rates r
  WHERE r.active = true
  ORDER BY r.sort_order ASC, r.name ASC;
$function$;

-- 5) get_active_pipeline: exclude ready_stock orders
CREATE OR REPLACE FUNCTION public.get_active_pipeline()
 RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
      AND (o.id IS NULL OR o.status::text NOT IN ('ready_stock','draft'))
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_kabel THEN 'packing'
      WHEN has_tempel THEN 'kabel'
      WHEN has_solder THEN 'tempel'
      WHEN has_potong THEN 'solder'
      WHEN has_cut THEN 'potong'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY
    CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
    deadline ASC,
    co_date DESC NULLS LAST,
    project_code DESC;
$function$;


-- ------------------------------------------------------------
-- FILE: 20260720074433_aa1c3bc6-e010-4b36-b8d3-934ef256a894.sql
-- ------------------------------------------------------------


-- 1) Add deadline & packing_kayu to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deadline date,
  ADD COLUMN IF NOT EXISTS packing_kayu boolean NOT NULL DEFAULT false;

-- 2) Propagate deadline to project via sync_order_to_project
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; proj_code text; has_logs boolean; item_count int;
BEGIN
  SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  IF item_count > 0 THEN
    RETURN NEW;  -- managed by sync_item_to_project
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN DELETE FROM public.projects WHERE id = proj_id; END IF;
    END IF;
    RETURN NEW;
  END IF;

  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
      deadline = NEW.deadline
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active', NEW.id, NEW.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
        deadline = NEW.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 3) sync_item_to_project also propagate deadline
CREATE OR REPLACE FUNCTION public.sync_item_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid; proj_code text;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
  header_proj_id uuid; header_has_logs boolean;
BEGIN
  IF NEW.kind <> 'custom' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO header_proj_id
    FROM public.projects
    WHERE parent_order_id = ord.id
      AND code = ord.order_no
    LIMIT 1;
  IF header_proj_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = header_proj_id) INTO header_has_logs;
    IF NOT header_has_logs THEN
      IF ord.project_id = header_proj_id THEN
        UPDATE public.orders SET project_id = NULL WHERE id = ord.id;
      END IF;
      DELETE FROM public.projects WHERE id = header_proj_id;
    END IF;
  END IF;

  proj_code := COALESCE(NULLIF(ord.order_no,''),'ORD') || '-' || NEW.position::text;
  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET code = proj_code,
          title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id,
          deadline = ord.deadline
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (proj_code,
              COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
              cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id, ord.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects
        SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            customer_id = cust_id,
            total_points = GREATEST(NEW.titik,0),
            contract_value = contract_val,
            parent_order_id = ord.id,
            deadline = ord.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 4) get_active_pipeline: add packing_kayu & use_outdoor flags
DROP FUNCTION IF EXISTS public.get_active_pipeline();
CREATE OR REPLACE FUNCTION public.get_active_pipeline()
 RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, packing_kayu boolean, use_outdoor boolean, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  order_outdoor AS (
    SELECT o.id AS order_id,
      COALESCE(BOOL_OR(COALESCE(o.outdoor_cost,0) > 0), false)
        OR COALESCE(BOOL_OR(COALESCE(oi.outdoor_cost,0) > 0), false) AS use_outdoor
    FROM public.orders o
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
    GROUP BY o.id
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(o.packing_kayu, false) AS packing_kayu,
      COALESCE(oo.use_outdoor, false) AS use_outdoor,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN order_outdoor oo ON oo.order_id = o.id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
      AND (o.id IS NULL OR o.status::text NOT IN ('ready_stock','draft'))
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at, o.packing_kayu, oo.use_outdoor
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    packing_kayu, use_outdoor,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_kabel THEN 'packing'
      WHEN has_tempel THEN 'kabel'
      WHEN has_solder THEN 'tempel'
      WHEN has_potong THEN 'solder'
      WHEN has_cut THEN 'potong'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY
    CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
    deadline ASC,
    co_date DESC NULLS LAST,
    project_code DESC;
$function$;

-- 5) get_project_detail_for_worker: include packing_kayu + outdoor_cost
CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', o.akrilik_p, 'akrilik_l', o.akrilik_l,
      'led_meter', o.led_meter, 'titik', o.titik,
      'kabel_meter', o.kabel_meter,
      'kabel_socket_meter', o.kabel_socket_meter,
      'notes', o.notes,
      'deadline', o.deadline,
      'packing_kayu', COALESCE(o.packing_kayu,false),
      'use_outdoor', (
        COALESCE(o.outdoor_cost,0) > 0
        OR EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND COALESCE(oi.outdoor_cost,0) > 0)
      )
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  WHERE p.id = _project_id;
  RETURN result;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260720074804_1f84fe67-377e-4392-9fb9-39ca0a5b3273.sql
-- ------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', o.akrilik_p, 'akrilik_l', o.akrilik_l,
      'led_meter', o.led_meter, 'titik', o.titik,
      'kabel_meter', o.kabel_meter,
      'kabel_socket_meter', o.kabel_socket_meter,
      'notes', o.notes,
      'deadline', o.deadline,
      'packing_kayu', COALESCE(o.packing_kayu, false),
      'use_outdoor', COALESCE(o.use_outdoor, false)
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  WHERE p.id = _project_id;
  RETURN result;
END $function$;


-- ------------------------------------------------------------
-- FILE: 20260721045016_a4983dd3-f8a1-408b-9162-5eba0df54b6b.sql
-- ------------------------------------------------------------


-- Fix get_project_detail_for_worker: compute use_outdoor (column doesn't exist)
CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', o.akrilik_p, 'akrilik_l', o.akrilik_l,
      'led_meter', o.led_meter, 'titik', o.titik,
      'kabel_meter', o.kabel_meter,
      'kabel_socket_meter', o.kabel_socket_meter,
      'notes', o.notes,
      'deadline', o.deadline,
      'packing_kayu', COALESCE(o.packing_kayu, false),
      'use_outdoor', (
        COALESCE(o.outdoor_cost,0) > 0
        OR EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND COALESCE(oi.outdoor_cost,0) > 0)
      )
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  WHERE p.id = _project_id;
  RETURN result;
END $function$;

-- Auto-close projects 48 hours after courier pickup (picked_up_at), not ready_pickup_at.
-- Ready-stock projects are excluded from active pipeline via order status and remain untouched here.
CREATE OR REPLACE FUNCTION public.close_projects_after_pickup_delay()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT o.project_id FROM public.orders o
          WHERE o.picked_up_at IS NOT NULL
            AND o.picked_up_at <= now() - interval '48 hours'
            AND o.project_id IS NOT NULL
            AND o.status::text NOT IN ('ready_stock','draft')
        UNION
        SELECT oi.project_id FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          WHERE o.picked_up_at IS NOT NULL
            AND o.picked_up_at <= now() - interval '48 hours'
            AND oi.project_id IS NOT NULL
            AND o.status::text NOT IN ('ready_stock','draft')
      );
END $function$;

-- Lookup any order by resi/no order (all statuses) for the Status page scanner
CREATE OR REPLACE FUNCTION public.lookup_order_by_resi(_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ord RECORD; q text;
BEGIN
  q := btrim(COALESCE(_query,''));
  IF q = '' THEN RETURN NULL; END IF;
  SELECT o.*, p.id AS proj_id
    INTO ord
    FROM public.orders o
    LEFT JOIN public.projects p ON p.parent_order_id = o.id
    WHERE o.no_resi = q OR lower(o.no_resi) = lower(q) OR lower(o.order_no) = lower(q)
    ORDER BY o.created_at DESC
    LIMIT 1;
  IF ord.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'order_id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'no_resi', ord.no_resi,
    'ekspedisi', ord.ekspedisi,
    'text_neon', ord.text_neon,
    'username', ord.username,
    'kota', ord.kota,
    'co_date', ord.co_date,
    'ready_pickup_at', ord.ready_pickup_at,
    'picked_up_at', ord.picked_up_at,
    'project_id', ord.proj_id
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.lookup_order_by_resi(text) TO authenticated;


-- ------------------------------------------------------------
-- FILE: 20260724083705_0ee1107d-b954-45b3-8760-e31e06baccaf.sql
-- ------------------------------------------------------------


CREATE TABLE public.shopping_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  qty text,
  note text,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','purchased')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_notes TO authenticated;
GRANT ALL ON public.shopping_notes TO service_role;

ALTER TABLE public.shopping_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shopping_notes_select_authenticated" ON public.shopping_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "shopping_notes_insert_authenticated" ON public.shopping_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "shopping_notes_update_own_or_admin" ON public.shopping_notes
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR public.is_admin_or_owner(auth.uid()) OR status = 'pending')
  WITH CHECK (true);

CREATE POLICY "shopping_notes_delete_own_or_admin" ON public.shopping_notes
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER shopping_notes_set_updated_at
  BEFORE UPDATE ON public.shopping_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX shopping_notes_status_idx ON public.shopping_notes(status, created_at DESC);


-- ------------------------------------------------------------
-- FILE: 20260728025111_fc9ceae9-6e69-47c4-90f1-7b3b3c8fedd4.sql
-- ------------------------------------------------------------

CREATE TABLE public.shopee_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  shop_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  lookback_days integer NOT NULL DEFAULT 7,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  last_sync_inserted integer DEFAULT 0,
  last_sync_updated integer DEFAULT 0,
  last_sync_skipped integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopee_settings_singleton CHECK (id = 1)
);

GRANT SELECT ON public.shopee_settings TO authenticated;
GRANT ALL ON public.shopee_settings TO service_role;

ALTER TABLE public.shopee_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/owner dapat melihat pengaturan Shopee"
  ON public.shopee_settings FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));

CREATE POLICY "Owner dapat mengubah pengaturan Shopee"
  ON public.shopee_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER update_shopee_settings_updated_at
  BEFORE UPDATE ON public.shopee_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.shopee_settings (id) VALUES (1);

CREATE TABLE public.shopee_order_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_sn text NOT NULL UNIQUE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  shopee_status text,
  raw jsonb,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shopee_order_map_order_id_idx ON public.shopee_order_map(order_id);

GRANT SELECT ON public.shopee_order_map TO authenticated;
GRANT ALL ON public.shopee_order_map TO service_role;

ALTER TABLE public.shopee_order_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/owner dapat melihat pemetaan pesanan Shopee"
  ON public.shopee_order_map FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER update_shopee_order_map_updated_at
  BEFORE UPDATE ON public.shopee_order_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- FILE: 20260728025148_134959b2-f36c-40c0-958c-1bcb01b7f220.sql
-- ------------------------------------------------------------

REVOKE SELECT ON public.shopee_settings FROM authenticated;

GRANT SELECT (
  id, shop_id, token_expires_at, connected_at, enabled, lookback_days,
  last_sync_at, last_sync_status, last_sync_message,
  last_sync_inserted, last_sync_updated, last_sync_skipped,
  created_at, updated_at
) ON public.shopee_settings TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260728030051_274926f4-8573-425d-9c41-17e92a2c8cb6.sql
-- ------------------------------------------------------------

ALTER TABLE public.shopee_settings
  ADD COLUMN partner_id text,
  ADD COLUMN partner_key text;

-- kolom baru sengaja TIDAK diberi GRANT SELECT ke authenticated,
-- sehingga partner_key tidak pernah terbaca dari browser.
GRANT SELECT (partner_id) ON public.shopee_settings TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260728030503_2a41175c-1fc6-47a4-9a2e-8c62649a2354.sql
-- ------------------------------------------------------------


-- [DINONAKTIFKAN untuk Supabase sendiri] Penjadwal pg_cron berikut menunjuk
-- alamat Lovable / memerlukan ekstensi pg_cron & pg_net. Gunakan Vercel Cron
-- sebagai gantinya (DEPLOY.md). Bila ingin tetap memakai pg_cron: aktifkan
-- ekstensi pg_cron dan pg_net di Dashboard > Database > Extensions, ganti URL
-- dan apikey di bawah dengan milik Anda, lalu hapus tanda komentar.

-- select cron.schedule(
--   'shopee-hourly-sync',
--   '7 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://project--2340221c-8701-4dfa-bbca-3ea03ca1e810.lovable.app/api/public/hooks/sync-shopee',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6ZWR1YWNrcXR0cnFiZ3FoaHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTMzNDYsImV4cCI6MjA5NzY4OTM0Nn0.N-dGb0JnhLb8ZUqjAUX72AVRoYN-lxFx_p_WE6UPCvE'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- ------------------------------------------------------------
-- FILE: 20260730042441_d6bd3bcc-e5c3-4a97-8ebd-f6df40e01fe1.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  src_proj uuid;
  new_item RECORD;
  new_ord RECORD;
  new_proj uuid;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO new_item FROM public.order_items WHERE id = _item_id;
  IF new_item.id IS NULL THEN RETURN; END IF;
  SELECT * INTO new_ord FROM public.orders WHERE id = new_item.order_id;

  SELECT oi.project_id INTO src_proj
    FROM public.order_items oi
    WHERE oi.order_id = _source_order_id AND oi.project_id IS NOT NULL
    ORDER BY oi.position LIMIT 1;
  IF src_proj IS NULL THEN
    SELECT id INTO src_proj FROM public.projects
      WHERE parent_order_id = _source_order_id ORDER BY created_at LIMIT 1;
  END IF;

  new_proj := new_item.project_id;

  IF src_proj IS NOT NULL THEN
    UPDATE public.order_items SET project_id = src_proj WHERE id = _item_id;

    IF new_proj IS NOT NULL AND new_proj <> src_proj THEN
      IF NOT EXISTS (SELECT 1 FROM public.job_logs WHERE project_id = new_proj) THEN
        UPDATE public.orders SET project_id = NULL WHERE project_id = new_proj;
        DELETE FROM public.projects WHERE id = new_proj;
      END IF;
    END IF;

    UPDATE public.projects
      SET code = COALESCE(NULLIF(new_ord.order_no,''),'ORD') || '-' || new_item.position::text,
          title = COALESCE(NULLIF(new_item.text_neon,''), title),
          parent_order_id = new_ord.id,
          deadline = new_ord.deadline,
          status = CASE WHEN status = 'done' THEN 'active'::project_status ELSE status END,
          updated_at = now()
      WHERE id = src_proj;
  END IF;

  DELETE FROM public.order_items WHERE order_id = _source_order_id;

  UPDATE public.orders
    SET hpp = 0,
        titik = 0,
        led_meter = 0,
        akrilik_p = 0,
        akrilik_l = 0,
        repair_cost = 0,
        text_neon = '(produk dipakai ulang di ' || COALESCE(NULLIF(new_ord.order_no,''),'order baru') || ')',
        profit = COALESCE(payment,0) + COALESCE(split,0),
        updated_at = now()
    WHERE id = _source_order_id;
END $$;

GRANT EXECUTE ON FUNCTION public.consume_stock_source(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260731071136_a7ff5e71-93c1-4389-a316-1b628c2149d6.sql
-- ------------------------------------------------------------

-- 1) Kode project mandiri
CREATE OR REPLACE FUNCTION public.next_project_code()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'P-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1)::text, 4, '0')
  FROM public.projects WHERE code ~ '^P-\d+$'
$$;

-- 2) Order tanpa item: project dibuat sekali dengan kode mandiri, kode tidak diubah lagi
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; has_logs boolean; item_count int;
BEGIN
  SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  IF item_count > 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN DELETE FROM public.projects WHERE id = proj_id; END IF;
    END IF;
    RETURN NEW;
  END IF;

  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
      deadline = NEW.deadline
      WHERE id = NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE parent_order_id = NEW.id LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (public.next_project_code(), NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active', NEW.id, NEW.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
        deadline = NEW.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 3) Item order: project dibuat sekali dengan kode mandiri; pindah order hanya mengubah parent_order_id
CREATE OR REPLACE FUNCTION public.sync_item_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
  header_proj_id uuid; header_has_logs boolean;
BEGIN
  IF NEW.kind <> 'custom' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Hapus project "header" (dibuat saat order belum punya item) bila tidak dipakai
  SELECT p.id INTO header_proj_id
    FROM public.projects p
    WHERE p.parent_order_id = ord.id
      AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id)
    LIMIT 1;
  IF header_proj_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = header_proj_id) INTO header_has_logs;
    IF NOT header_has_logs THEN
      IF ord.project_id = header_proj_id THEN
        UPDATE public.orders SET project_id = NULL WHERE id = ord.id;
      END IF;
      DELETE FROM public.projects WHERE id = header_proj_id;
    END IF;
  END IF;

  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id,
          deadline = ord.deadline,
          status = CASE WHEN status = 'done' THEN 'active'::project_status ELSE status END
      WHERE id = NEW.project_id;
  ELSE
    INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
    VALUES (public.next_project_code(),
            COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id, ord.deadline)
    RETURNING id INTO proj_id;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 4) Ambil produk dari order retur/ready stock: project pindah, order sumber menyimpan riwayat produk
CREATE OR REPLACE FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  src_proj uuid;
  new_item RECORD;
  new_ord RECORD;
  new_proj uuid;
  hist text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO new_item FROM public.order_items WHERE id = _item_id;
  IF new_item.id IS NULL THEN RETURN; END IF;
  SELECT * INTO new_ord FROM public.orders WHERE id = new_item.order_id;

  SELECT oi.project_id INTO src_proj
    FROM public.order_items oi
    WHERE oi.order_id = _source_order_id AND oi.project_id IS NOT NULL
    ORDER BY oi.position LIMIT 1;
  IF src_proj IS NULL THEN
    SELECT id INTO src_proj FROM public.projects
      WHERE parent_order_id = _source_order_id ORDER BY created_at LIMIT 1;
  END IF;

  -- riwayat produk pada order sumber
  SELECT string_agg(COALESCE(NULLIF(oi.text_neon,''), NULLIF(oi.manual_name,''), 'Item'), ' | ' ORDER BY oi.position)
    INTO hist FROM public.order_items oi WHERE oi.order_id = _source_order_id;
  IF hist IS NULL OR hist = '' THEN
    SELECT text_neon INTO hist FROM public.orders WHERE id = _source_order_id;
  END IF;

  new_proj := new_item.project_id;

  IF src_proj IS NOT NULL THEN
    UPDATE public.order_items SET project_id = src_proj WHERE id = _item_id;

    IF new_proj IS NOT NULL AND new_proj <> src_proj THEN
      IF NOT EXISTS (SELECT 1 FROM public.job_logs WHERE project_id = new_proj) THEN
        UPDATE public.orders SET project_id = NULL WHERE project_id = new_proj;
        DELETE FROM public.projects WHERE id = new_proj;
      END IF;
    END IF;

    -- kode project TIDAK diubah (project punya penomoran sendiri)
    UPDATE public.projects
      SET title = COALESCE(NULLIF(new_item.text_neon,''), title),
          parent_order_id = new_ord.id,
          deadline = new_ord.deadline,
          status = CASE WHEN status = 'done' THEN 'active'::project_status ELSE status END,
          updated_at = now()
      WHERE id = src_proj;
  END IF;

  DELETE FROM public.order_items WHERE order_id = _source_order_id;

  UPDATE public.orders
    SET hpp = 0,
        titik = 0,
        led_meter = 0,
        akrilik_p = 0,
        akrilik_l = 0,
        repair_cost = 0,
        project_id = NULL,
        text_neon = COALESCE(NULLIF(hist,''), 'Produk') || ' — dipindah ke ' || COALESCE(NULLIF(new_ord.order_no,''),'order baru'),
        profit = COALESCE(payment,0) + COALESCE(split,0),
        updated_at = now()
    WHERE id = _source_order_id;
END $function$;

-- ------------------------------------------------------------
-- FILE: 20260806062814_a34981ce-a245-4da1-ae97-b9329c9e3c93.sql
-- ------------------------------------------------------------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone text;

-- ------------------------------------------------------------
-- FILE: 20260810055325_f0f6ce55-90a2-4f11-bd94-90d86f9c6640.sql
-- ------------------------------------------------------------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_order_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; has_logs boolean; item_count int;
BEGIN
  SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  IF item_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Order yang produknya sudah dipindahkan ke order lain: jangan buat project baru
  IF NEW.consumed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN DELETE FROM public.projects WHERE id = proj_id; END IF;
    END IF;
    RETURN NEW;
  END IF;

  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
      deadline = NEW.deadline
      WHERE id = NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE parent_order_id = NEW.id LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (public.next_project_code(), NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active', NEW.id, NEW.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
        deadline = NEW.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src_proj uuid;
  new_item RECORD;
  new_ord RECORD;
  new_proj uuid;
  hist text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO new_item FROM public.order_items WHERE id = _item_id;
  IF new_item.id IS NULL THEN RETURN; END IF;
  SELECT * INTO new_ord FROM public.orders WHERE id = new_item.order_id;

  SELECT oi.project_id INTO src_proj
    FROM public.order_items oi
    WHERE oi.order_id = _source_order_id AND oi.project_id IS NOT NULL
    ORDER BY oi.position LIMIT 1;
  IF src_proj IS NULL THEN
    SELECT id INTO src_proj FROM public.projects
      WHERE parent_order_id = _source_order_id ORDER BY created_at LIMIT 1;
  END IF;

  SELECT string_agg(COALESCE(NULLIF(oi.text_neon,''), NULLIF(oi.manual_name,''), 'Item'), ' | ' ORDER BY oi.position)
    INTO hist FROM public.order_items oi WHERE oi.order_id = _source_order_id;
  IF hist IS NULL OR hist = '' THEN
    SELECT text_neon INTO hist FROM public.orders WHERE id = _source_order_id;
  END IF;

  new_proj := new_item.project_id;

  IF src_proj IS NOT NULL THEN
    UPDATE public.order_items SET project_id = src_proj WHERE id = _item_id;

    IF new_proj IS NOT NULL AND new_proj <> src_proj THEN
      IF NOT EXISTS (SELECT 1 FROM public.job_logs WHERE project_id = new_proj) THEN
        UPDATE public.orders SET project_id = NULL WHERE project_id = new_proj;
        DELETE FROM public.projects WHERE id = new_proj;
      END IF;
    END IF;

    UPDATE public.projects
      SET title = COALESCE(NULLIF(new_item.text_neon,''), title),
          parent_order_id = new_ord.id,
          deadline = new_ord.deadline,
          status = CASE WHEN status = 'done' THEN 'active'::project_status ELSE status END,
          updated_at = now()
      WHERE id = src_proj;
  END IF;

  DELETE FROM public.order_items WHERE order_id = _source_order_id;

  UPDATE public.orders
    SET hpp = 0,
        titik = 0,
        led_meter = 0,
        akrilik_p = 0,
        akrilik_l = 0,
        repair_cost = 0,
        project_id = NULL,
        consumed_at = now(),
        text_neon = COALESCE(NULLIF(hist,''), 'Produk') || ' — dipindah ke ' || COALESCE(NULLIF(new_ord.order_no,''),'order baru'),
        profit = COALESCE(payment,0) + COALESCE(split,0),
        updated_at = now()
    WHERE id = _source_order_id;
END $function$;

-- Tandai order lama yang produknya sudah dipindahkan
UPDATE public.orders SET consumed_at = COALESCE(consumed_at, updated_at, now())
WHERE text_neon LIKE '%— dipindah ke %';

-- Bersihkan project hantu hasil duplikasi
UPDATE public.orders o SET project_id = NULL
WHERE o.project_id IN (
  SELECT p.id FROM public.projects p
  JOIN public.orders so ON so.id = p.parent_order_id
  WHERE so.consumed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.job_logs jl WHERE jl.project_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id)
);

DELETE FROM public.projects p
USING public.orders so
WHERE so.id = p.parent_order_id
  AND so.consumed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.job_logs jl WHERE jl.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id);

-- ------------------------------------------------------------
-- FILE: 20260812082414_2d621ea6-c99e-4f49-8b35-d7931a5c393f.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_order_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE max_no int; max_rs int; max_dr int; is_rs boolean; is_dr boolean;
BEGIN
  IF NEW.status = 'draft' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR NOT (NEW.order_no ~* '^DR-\d+$') THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_dr
        FROM public.orders
        WHERE order_no ~ '^DR-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'DR-' || (max_dr + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'ready_stock' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_rs
        FROM public.orders
        WHERE order_no ~ '^RS-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'RS-' || (max_rs + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  -- active/return
  is_rs := NEW.order_no ~* '^RS-';
  is_dr := NEW.order_no ~* '^DR-';
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR is_rs OR is_dr THEN
    -- Cari nomor terbesar dari SEMUA order bernomor angka (tanpa memandang status),
    -- supaya tidak bentrok dengan ready stock/draft yang memakai nomor angka biasa.
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE order_no !~* '^RS-'
        AND order_no !~* '^DR-'
        AND order_no !~ '-D\d+$'
        AND order_no ~ '^\d+$'
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- FILE: 20260813015935_5e78028b-5306-4a7e-b3e1-bda84410ec9d.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.detach_project_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  oid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    pid := OLD.project_id; oid := OLD.order_id;
  ELSE
    pid := OLD.project_id; oid := OLD.order_id;
    IF pid IS NOT DISTINCT FROM NEW.project_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF pid IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = pid) THEN
    UPDATE public.orders SET project_id = NULL WHERE id = oid AND project_id = pid;
    UPDATE public.projects
      SET parent_order_id = NULL,
          status = CASE WHEN status = 'cancelled' THEN status ELSE 'active'::project_status END
      WHERE id = pid;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_detach_project_on_item_delete ON public.order_items;
CREATE TRIGGER trg_detach_project_on_item_delete
AFTER DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.detach_project_from_order();

DROP TRIGGER IF EXISTS trg_detach_project_on_item_update ON public.order_items;
CREATE TRIGGER trg_detach_project_on_item_update
AFTER UPDATE OF project_id ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.detach_project_from_order();

UPDATE public.projects p
SET parent_order_id = NULL
WHERE p.parent_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p.parent_order_id AND o.project_id = p.id);

-- ------------------------------------------------------------
-- FILE: 20260813020021_e7b65f2f-555a-4058-a8c4-fa03cae364d9.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.detach_project_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  oid uuid;
BEGIN
  pid := OLD.project_id; oid := OLD.order_id;

  IF TG_OP = 'UPDATE' AND pid IS NOT DISTINCT FROM NEW.project_id THEN
    RETURN NEW;
  END IF;

  IF pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = pid) THEN
    UPDATE public.orders SET project_id = NULL WHERE id = oid AND project_id = pid;
    UPDATE public.projects
      SET parent_order_id = NULL,
          status = CASE WHEN status = 'cancelled' THEN status ELSE 'active'::project_status END
      WHERE id = pid;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Cleanup: lepaskan project header lama pada order yang sudah punya item sendiri
UPDATE public.orders o
SET project_id = NULL
WHERE o.project_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = o.project_id);

UPDATE public.projects p
SET parent_order_id = NULL
WHERE p.parent_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p.parent_order_id AND o.project_id = p.id);

-- ------------------------------------------------------------
-- FILE: 20260813020525_81a62f91-fd29-4931-a90f-9f3be19351d4.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_active_pipeline()
RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, packing_kayu boolean, use_outdoor boolean, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  order_outdoor AS (
    SELECT o.id AS order_id,
      COALESCE(BOOL_OR(COALESCE(o.outdoor_cost,0) > 0), false)
        OR COALESCE(BOOL_OR(COALESCE(oi.outdoor_cost,0) > 0), false) AS use_outdoor
    FROM public.orders o
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
    GROUP BY o.id
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(o.packing_kayu, false) AS packing_kayu,
      COALESCE(oo.use_outdoor, false) AS use_outdoor,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN order_outdoor oo ON oo.order_id = o.id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
      AND o.status::text NOT IN ('ready_stock','draft')
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at, o.packing_kayu, oo.use_outdoor
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    packing_kayu, use_outdoor,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_kabel THEN 'packing'
      WHEN has_tempel THEN 'kabel'
      WHEN has_solder THEN 'tempel'
      WHEN has_potong THEN 'solder'
      WHEN has_cut THEN 'potong'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY
    CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
    deadline ASC,
    co_date DESC NULLS LAST,
    project_code DESC;
$fn$;

-- ------------------------------------------------------------
-- FILE: 20260814011646_6a20bab6-7099-46df-b22f-00167f53c084.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', COALESCE(NULLIF(oi.akrilik_p, 0), o.akrilik_p),
      'akrilik_l', COALESCE(NULLIF(oi.akrilik_l, 0), o.akrilik_l),
      'led_meter', COALESCE(NULLIF(oi.led_meter, 0), o.led_meter),
      'titik', COALESCE(NULLIF(oi.titik, 0), o.titik),
      'kabel_meter', COALESCE(NULLIF(oi.kabel_meter, 0), o.kabel_meter),
      'kabel_socket_meter', COALESCE(NULLIF(oi.kabel_socket_meter, 0), o.kabel_socket_meter),
      'notes', o.notes,
      'deadline', o.deadline,
      'packing_kayu', COALESCE(o.packing_kayu, false),
      'use_outdoor', (
        COALESCE(o.outdoor_cost,0) > 0
        OR EXISTS (SELECT 1 FROM public.order_items oi2 WHERE oi2.order_id = o.id AND COALESCE(oi2.outdoor_cost,0) > 0)
      )
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.order_items x
    WHERE x.project_id = p.id AND x.order_id = o.id
    ORDER BY x.position LIMIT 1
  ) oi ON true
  WHERE p.id = _project_id;
  RETURN result;
END $$;

-- ------------------------------------------------------------
-- FILE: 20260818114154_0ab83b72-f4cd-4051-8dd6-57b8a7110a87.sql
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_available_projects();
CREATE OR REPLACE FUNCTION public.get_available_projects()
 RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric, parent_order_id uuid, order_no text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id, COALESCE(pricing_mode,'per_unit') AS pricing_mode
    FROM public.job_rates
    WHERE active = true
  ), project_availability AS (
    SELECT
      p.id,
      p.code,
      p.title,
      p.status,
      COALESCE(SUM(CASE WHEN ar.pricing_mode = 'area' THEN 1 ELSE p.total_points END), 0)::integer AS total_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 1 ELSE 0 END
        ELSE LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)
      END), 0) AS claimed_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 0 ELSE 1 END
        ELSE GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)
      END), 0) AS remaining_points,
      p.parent_order_id,
      o.order_no,
      p.created_at
    FROM public.projects p
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty, COUNT(*) > 0 AS has_claim
      FROM public.job_logs jl
      WHERE jl.project_id = p.id
        AND jl.rate_id = ar.id
        AND jl.status <> 'rejected'
        AND COALESCE(jl.is_repair,false) = false
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.parent_order_id, o.order_no, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points, parent_order_id, order_no
  FROM project_availability
  ORDER BY created_at DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260819121935_b194b332-ee30-458d-b0b4-9268e3a11b35.sql
-- ------------------------------------------------------------

ALTER TABLE public.job_rates ADD COLUMN IF NOT EXISTS require_photo boolean NOT NULL DEFAULT false;
UPDATE public.job_rates SET require_photo = true WHERE name ILIKE '%kabel%';

-- ------------------------------------------------------------
-- FILE: 20260820015955_5454ffcf-3448-4cae-90b5-e78a47a73e00.sql
-- ------------------------------------------------------------

create or replace function public.link_project_to_order(_project_id uuid, _order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  it record;
  nextpos int;
begin
  if not public.is_admin_or_owner(auth.uid()) then
    raise exception 'Forbidden: hanya admin/owner';
  end if;

  select * into p from public.projects where id = _project_id;
  if not found then raise exception 'Project tidak ditemukan'; end if;

  select * into it from public.order_items where project_id = _project_id order by created_at limit 1;

  if _order_id is null then
    if found then
      delete from public.order_items where id = it.id;
    else
      update public.projects set parent_order_id = null where id = _project_id;
    end if;
    return;
  end if;

  select coalesce(max(position),0) + 1 into nextpos from public.order_items where order_id = _order_id;

  if it.id is not null then
    if it.order_id = _order_id then
      update public.projects set parent_order_id = _order_id where id = _project_id;
      return;
    end if;
    update public.order_items set order_id = _order_id, position = nextpos where id = it.id;
  else
    insert into public.order_items(order_id, position, kind, project_id, text_neon, titik)
    values (_order_id, nextpos, 'custom', _project_id,
            coalesce(nullif(p.title,''), p.code), greatest(coalesce(p.total_points,0),0));
  end if;

  update public.projects set parent_order_id = _order_id where id = _project_id;
end;
$$;

grant execute on function public.link_project_to_order(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- FILE: 20260820020027_0acfb159-e7c7-431b-b8bf-d021d424e674.sql
-- ------------------------------------------------------------

revoke execute on function public.link_project_to_order(uuid, uuid) from public, anon;
grant execute on function public.link_project_to_order(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- FILE: 20260821034000_2cf0daab-87f9-40ab-baf3-c57ec1a08422.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.detach_projects_on_order_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.projects
    SET parent_order_id = NULL,
        status = CASE WHEN status = 'cancelled' THEN status ELSE 'active'::project_status END
  WHERE parent_order_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_detach_projects_on_order_delete ON public.orders;
CREATE TRIGGER trg_detach_projects_on_order_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.detach_projects_on_order_delete();

DROP FUNCTION IF EXISTS public.get_available_projects();
CREATE FUNCTION public.get_available_projects()
 RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric, parent_order_id uuid, order_no text, order_status text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id, COALESCE(pricing_mode,'per_unit') AS pricing_mode
    FROM public.job_rates WHERE active = true
  ), project_availability AS (
    SELECT
      p.id, p.code, p.title, p.status,
      COALESCE(SUM(CASE WHEN ar.pricing_mode = 'area' THEN 1 ELSE p.total_points END), 0)::integer AS total_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 1 ELSE 0 END
        ELSE LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)
      END), 0) AS claimed_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 0 ELSE 1 END
        ELSE GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)
      END), 0) AS remaining_points,
      p.parent_order_id, o.order_no, o.status AS order_status, p.created_at
    FROM public.projects p
    JOIN public.orders o ON o.id = p.parent_order_id
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty, COUNT(*) > 0 AS has_claim
      FROM public.job_logs jl
      WHERE jl.project_id = p.id AND jl.rate_id = ar.id
        AND jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.parent_order_id, o.order_no, o.status, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points, parent_order_id, order_no, order_status
  FROM project_availability
  ORDER BY created_at DESC;
$function$;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

UPDATE public.projects p SET parent_order_id = NULL
WHERE p.parent_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p.parent_order_id);

-- ------------------------------------------------------------
-- FILE: 20260825120052_39b19d88-8e15-4615-bb69-82e34f129971.sql
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_order_history(_limit int DEFAULT 500)
RETURNS TABLE(
  order_id uuid,
  order_no text,
  no_resi text,
  ekspedisi text,
  username text,
  kota text,
  text_neon text,
  co_date date,
  ready_pickup_at timestamptz,
  picked_up_at timestamptz,
  order_status text,
  projects jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_no,
    o.no_resi,
    o.ekspedisi,
    o.username,
    o.kota,
    o.text_neon,
    o.co_date,
    o.ready_pickup_at,
    o.picked_up_at,
    o.status,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', p.id, 'code', p.code, 'title', p.title, 'status', p.status)
        ORDER BY p.code
      )
      FROM public.projects p
      WHERE p.parent_order_id = o.id
    ), '[]'::jsonb) AS projects
  FROM public.orders o
  WHERE o.picked_up_at IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.projects p2
       WHERE p2.parent_order_id = o.id AND p2.status = 'done'
     )
  ORDER BY COALESCE(o.picked_up_at, o.updated_at) DESC
  LIMIT _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_order_history(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_order_history(int) TO authenticated;

-- ------------------------------------------------------------
-- FILE: 20260826114810_709b92e3-f4d9-4107-bad3-b89054c6e5b8.sql
-- ------------------------------------------------------------

ALTER TABLE public.shopee_settings ADD COLUMN redirect_url text;

-- Izinkan user login membaca redirect_url agar UI bisa menampilkannya.
GRANT SELECT (redirect_url) ON public.shopee_settings TO authenticated;

-- Pastikan service_role tetap punya akses penuh ke seluruh kolom.
GRANT ALL ON public.shopee_settings TO service_role;

-- ------------------------------------------------------------
-- FILE: 20260903024603_3eeeedd4-15a9-4976-9220-fef523137fc3.sql
-- ------------------------------------------------------------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shopee_label_pdf text;