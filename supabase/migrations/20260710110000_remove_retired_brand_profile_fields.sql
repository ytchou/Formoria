UPDATE public.brands
SET reputation_summary = jsonb_build_object(
  'text', COALESCE(reputation_summary->>'text', ''),
  'sources', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('url', source->>'url'))
    FROM jsonb_array_elements(COALESCE(reputation_summary->'sources', '[]'::jsonb)) AS source
    WHERE NULLIF(BTRIM(source->>'url'), '') IS NOT NULL
  ), '[]'::jsonb)
)
WHERE reputation_summary IS NOT NULL;

UPDATE public.brands
SET draft_data = draft_data - ARRAY['customerVoices', 'manufacturing', 'certifications', 'policies']
WHERE draft_data IS NOT NULL;

UPDATE public.brands
SET draft_data = jsonb_set(
  draft_data,
  '{reputationSummary}',
  jsonb_build_object(
    'text', COALESCE(draft_data->'reputationSummary'->>'text', ''),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('url', source->>'url'))
      FROM jsonb_array_elements(COALESCE(draft_data->'reputationSummary'->'sources', '[]'::jsonb)) AS source
      WHERE NULLIF(BTRIM(source->>'url'), '') IS NOT NULL
    ), '[]'::jsonb)
  )
)
WHERE draft_data ? 'reputationSummary';

UPDATE public.pending_brand_edits
SET proposed_data = proposed_data - ARRAY['customerVoices', 'manufacturing', 'certifications', 'policies'];

UPDATE public.pending_brand_edits
SET proposed_data = jsonb_set(
  proposed_data,
  '{reputationSummary}',
  jsonb_build_object(
    'text', COALESCE(proposed_data->'reputationSummary'->>'text', ''),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('url', source->>'url'))
      FROM jsonb_array_elements(COALESCE(proposed_data->'reputationSummary'->'sources', '[]'::jsonb)) AS source
      WHERE NULLIF(BTRIM(source->>'url'), '') IS NOT NULL
    ), '[]'::jsonb)
  )
)
WHERE proposed_data ? 'reputationSummary';

DELETE FROM public.brand_field_state
WHERE field IN ('customer_voices', 'manufacturing', 'certifications', 'policies');

ALTER TABLE public.brands
  DROP COLUMN IF EXISTS customer_voices,
  DROP COLUMN IF EXISTS manufacturing,
  DROP COLUMN IF EXISTS certifications,
  DROP COLUMN IF EXISTS policies;

DROP FUNCTION IF EXISTS public.profile_completeness(uuid);
