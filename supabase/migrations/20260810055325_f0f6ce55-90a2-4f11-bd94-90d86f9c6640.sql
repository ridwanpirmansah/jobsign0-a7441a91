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