CREATE TABLE public.brand_onboarding_steps (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (
    step_key IN ('basics', 'products', 'story_media', 'purchase', 'social_proof')
  ),
  status text NOT NULL DEFAULT 'not_started' CHECK (
    status IN ('not_started', 'in_progress', 'complete')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, step_key)
);

ALTER TABLE public.brand_onboarding_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_select_brand_onboarding_steps
  ON public.brand_onboarding_steps
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_owners bo
      WHERE bo.brand_id = brand_onboarding_steps.brand_id
        AND bo.user_id = auth.uid()
    )
  );

CREATE POLICY owner_insert_brand_onboarding_steps
  ON public.brand_onboarding_steps
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_owners bo
      WHERE bo.brand_id = brand_onboarding_steps.brand_id
        AND bo.user_id = auth.uid()
    )
    AND completed_by_user_id = auth.uid()
  );

CREATE POLICY owner_update_brand_onboarding_steps
  ON public.brand_onboarding_steps
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_owners bo
      WHERE bo.brand_id = brand_onboarding_steps.brand_id
        AND bo.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_owners bo
      WHERE bo.brand_id = brand_onboarding_steps.brand_id
        AND bo.user_id = auth.uid()
    )
    AND completed_by_user_id = auth.uid()
  );

CREATE POLICY "Brand owners can delete their onboarding steps"
  ON public.brand_onboarding_steps
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands
      WHERE brands.id = brand_onboarding_steps.brand_id
        AND brands.owner_id = auth.uid()
    )
  );

CREATE POLICY service_role_all_brand_onboarding_steps
  ON public.brand_onboarding_steps
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX brand_onboarding_steps_status_idx
  ON public.brand_onboarding_steps (brand_id, status);

ALTER TABLE public.brand_onboarding_steps ADD CONSTRAINT check_step_data_integrity
  CHECK (
    (status = 'complete' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL)
    OR
    (status != 'complete' AND completed_at IS NULL)
  );
