
CREATE TABLE public.sync_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  spreadsheet_id text,
  sheet_name text,
  header_row int NOT NULL DEFAULT 1,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  last_sync_inserted int DEFAULT 0,
  last_sync_updated int DEFAULT 0,
  last_sync_skipped int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_settings_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_settings TO authenticated;
GRANT ALL ON public.sync_settings TO service_role;

ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin/owner can view sync_settings"
  ON public.sync_settings FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));

CREATE POLICY "owner can update sync_settings"
  ON public.sync_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "owner can insert sync_settings"
  ON public.sync_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER trg_sync_settings_updated
  BEFORE UPDATE ON public.sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sync_settings (id, spreadsheet_id, sheet_name, mapping)
VALUES (1, '17TavOyXTnDAkpdZutI8-aPEE2oB2Qf4i', 'ORDER NEON', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
