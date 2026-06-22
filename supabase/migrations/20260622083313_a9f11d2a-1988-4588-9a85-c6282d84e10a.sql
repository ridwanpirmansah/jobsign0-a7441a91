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