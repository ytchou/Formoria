BEGIN;

ALTER TABLE public.brand_reports
  DROP CONSTRAINT brand_reports_reason_check;

ALTER TABLE public.brand_reports
  ADD CONSTRAINT brand_reports_reason_check CHECK (
    reason IN (
      'not_mit',
      'incorrect_info',
      'broken_link',
      'inappropriate',
      'ownership_dispute',
      'removal_request'
    )
  );

DROP POLICY owner_select_brand_reports ON public.brand_reports;

CREATE POLICY owner_select_brand_reports
  ON public.brand_reports
  FOR SELECT
  TO authenticated
  USING (
    reason NOT IN ('ownership_dispute', 'removal_request')
    AND EXISTS (
      SELECT 1
      FROM public.brand_owners AS bo
      WHERE bo.brand_id = brand_reports.brand_id
        AND bo.user_id = (SELECT auth.uid())
    )
  );

COMMIT;
