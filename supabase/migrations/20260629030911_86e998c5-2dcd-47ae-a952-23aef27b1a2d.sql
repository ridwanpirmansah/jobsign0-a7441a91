ALTER TABLE public.orders DROP CONSTRAINT orders_status_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_chk CHECK (status = ANY (ARRAY['active','return','draft','ready_stock']));