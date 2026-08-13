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