
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
