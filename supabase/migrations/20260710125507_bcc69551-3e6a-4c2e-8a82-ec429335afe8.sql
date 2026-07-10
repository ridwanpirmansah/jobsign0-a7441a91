
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
