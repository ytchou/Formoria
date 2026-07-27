WITH normalized_link_rows AS (
  SELECT
    id,
    'link:link-cleanup:' || regexp_replace(
      fingerprint,
      '^link:(?:link-cleanup|cleanup-required|cleanup):',
      ''
    ) AS canonical_fingerprint,
    fingerprint,
    status,
    updated_at
  FROM public.health_fix_queue
  WHERE fingerprint LIKE 'link:link-cleanup:%'
     OR fingerprint LIKE 'link:cleanup-required:%'
     OR fingerprint LIKE 'link:cleanup:%'
),
ranked_link_rows AS (
  SELECT
    id,
    canonical_fingerprint,
    row_number() OVER (
      PARTITION BY canonical_fingerprint
      ORDER BY
        (status IN (
          'pending', 'claimed', 'pr_opened', 'awaiting_human', 'merged',
          'deployed', 'failed', 'needs_human'
        )) DESC,
        CASE
          WHEN fingerprint LIKE 'link:link-cleanup:%' THEN 0
          WHEN fingerprint LIKE 'link:cleanup:%' THEN 1
          ELSE 2
        END,
        updated_at DESC,
        id DESC
    ) AS occurrence
  FROM normalized_link_rows
)
UPDATE public.health_fix_queue AS queue
SET status = 'skipped',
    last_error = 'superseded_by_canonical_link_owner',
    updated_at = now()
FROM ranked_link_rows
WHERE queue.id = ranked_link_rows.id
  AND ranked_link_rows.occurrence > 1
  AND queue.status <> 'skipped';

WITH normalized_link_rows AS (
  SELECT
    id,
    'link:link-cleanup:' || regexp_replace(
      fingerprint,
      '^link:(?:link-cleanup|cleanup-required|cleanup):',
      ''
    ) AS canonical_fingerprint
  FROM public.health_fix_queue
  WHERE fingerprint LIKE 'link:link-cleanup:%'
     OR fingerprint LIKE 'link:cleanup-required:%'
     OR fingerprint LIKE 'link:cleanup:%'
)
UPDATE public.health_fix_queue AS queue
SET source = 'link',
    fingerprint = normalized_link_rows.canonical_fingerprint,
    updated_at = now()
FROM normalized_link_rows
WHERE queue.id = normalized_link_rows.id;
