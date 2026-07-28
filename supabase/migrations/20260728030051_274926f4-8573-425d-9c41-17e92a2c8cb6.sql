ALTER TABLE public.shopee_settings
  ADD COLUMN partner_id text,
  ADD COLUMN partner_key text;

-- kolom baru sengaja TIDAK diberi GRANT SELECT ke authenticated,
-- sehingga partner_key tidak pernah terbaca dari browser.
GRANT SELECT (partner_id) ON public.shopee_settings TO authenticated;