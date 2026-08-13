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