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