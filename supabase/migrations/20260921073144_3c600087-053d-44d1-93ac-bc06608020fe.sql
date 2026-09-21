INSERT INTO public.material_prices (key, label, value, unit)
VALUES
  ('akrilik_2mm_per_cm2', 'Akrilik 2mm', 15, 'per cm²'),
  ('akrilik_3mm_per_cm2', 'Akrilik 3mm', 22, 'per cm²')
ON CONFLICT (key) DO NOTHING;