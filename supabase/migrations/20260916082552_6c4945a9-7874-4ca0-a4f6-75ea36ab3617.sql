ALTER TABLE public.printer_settings
  ADD COLUMN IF NOT EXISTS paper_dots integer NOT NULL DEFAULT 576,
  ADD COLUMN IF NOT EXISTS content_dots integer NOT NULL DEFAULT 544,
  ADD COLUMN IF NOT EXISTS align text NOT NULL DEFAULT 'center';

ALTER TABLE public.printer_settings
  DROP CONSTRAINT IF EXISTS printer_settings_align_check;
ALTER TABLE public.printer_settings
  ADD CONSTRAINT printer_settings_align_check CHECK (align IN ('left','center','right'));