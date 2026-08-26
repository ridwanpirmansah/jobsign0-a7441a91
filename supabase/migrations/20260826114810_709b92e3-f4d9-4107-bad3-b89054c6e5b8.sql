ALTER TABLE public.shopee_settings ADD COLUMN redirect_url text;

-- Izinkan user login membaca redirect_url agar UI bisa menampilkannya.
GRANT SELECT (redirect_url) ON public.shopee_settings TO authenticated;

-- Pastikan service_role tetap punya akses penuh ke seluruh kolom.
GRANT ALL ON public.shopee_settings TO service_role;