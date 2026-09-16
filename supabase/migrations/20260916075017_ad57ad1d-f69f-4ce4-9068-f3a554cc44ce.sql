CREATE TABLE public.printer_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  width_mm integer NOT NULL DEFAULT 58 CHECK (width_mm BETWEEN 30 AND 120),
  dots_58 integer NOT NULL DEFAULT 384 CHECK (dots_58 BETWEEN 256 AND 576),
  dots_80 integer NOT NULL DEFAULT 576 CHECK (dots_80 BETWEEN 384 AND 640),
  inset_dots integer NOT NULL DEFAULT 16 CHECK (inset_dots BETWEEN 0 AND 64),
  density smallint NOT NULL DEFAULT 2 CHECK (density BETWEEN 1 AND 3),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.printer_settings TO authenticated;
GRANT ALL ON public.printer_settings TO service_role;

ALTER TABLE public.printer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read printer settings"
ON public.printer_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can update printer settings"
ON public.printer_settings
FOR UPDATE
TO authenticated
USING (public.is_admin_or_owner(auth.uid()))
WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER update_printer_settings_updated_at
BEFORE UPDATE ON public.printer_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.printer_settings (id) VALUES (1);