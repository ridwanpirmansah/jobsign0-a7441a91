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