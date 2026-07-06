-- Align CHECK constraint with TypeScript ONBOARDING_STEPS constants (DEV-957)
DELETE FROM public.brand_onboarding_steps
  WHERE step_key NOT IN ('brand_basics', 'media_links', 'analytics', 'health', 'verification');

ALTER TABLE public.brand_onboarding_steps
  DROP CONSTRAINT brand_onboarding_steps_step_key_check;

ALTER TABLE public.brand_onboarding_steps
  ADD CONSTRAINT brand_onboarding_steps_step_key_check
  CHECK (step_key IN ('brand_basics', 'media_links', 'analytics', 'health', 'verification'));
