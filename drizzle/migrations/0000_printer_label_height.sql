ALTER TABLE public.printer_settings ADD COLUMN IF NOT EXISTS height_mm integer NOT NULL DEFAULT 0;
ALTER TABLE public.printer_settings ADD CONSTRAINT printer_settings_height_mm_check CHECK (height_mm = 0 OR height_mm BETWEEN 20 AND 500);
COMMENT ON COLUMN public.printer_settings.height_mm IS 'Thermal label feed length in millimeters; 0 preserves continuous-paper printing.';