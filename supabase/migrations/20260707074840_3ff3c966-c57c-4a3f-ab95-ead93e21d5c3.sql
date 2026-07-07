
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
