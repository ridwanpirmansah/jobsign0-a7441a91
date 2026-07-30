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