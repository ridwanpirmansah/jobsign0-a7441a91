ALTER TABLE public.job_rates ADD COLUMN IF NOT EXISTS require_photo boolean NOT NULL DEFAULT false;
UPDATE public.job_rates SET require_photo = true WHERE name ILIKE '%kabel%';