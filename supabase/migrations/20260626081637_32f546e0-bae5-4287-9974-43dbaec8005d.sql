ALTER TABLE public.orders ALTER COLUMN outdoor_cost DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN outdoor_cost DROP DEFAULT;
ALTER TABLE public.orders ALTER COLUMN kabel_meter DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN kabel_meter DROP DEFAULT;