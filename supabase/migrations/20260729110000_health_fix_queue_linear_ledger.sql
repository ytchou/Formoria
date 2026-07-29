-- Ledger columns for the one-digest-ticket-per-run Linear writer.
--
-- The health agent used to rewrite a single rolling Linear ticket. It now
-- creates one fresh digest ticket per nightly run covering only findings that
-- have never been ticketed. "Never been ticketed" needs a durable ledger:
-- lifecycle "new" means "no active queue row", which is wrong for 'skipped'
-- rows and for automatic-policy rows that were enqueued but never ticketed.
--
-- ticketed_at IS NULL (on a row in an active status) is the sole predicate.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.health_fix_queue_unticketed_idx;
--   ALTER TABLE public.health_fix_queue
--     DROP COLUMN IF EXISTS ticketed_at,
--     DROP COLUMN IF EXISTS linear_identifier;
--   (The old code ignores both columns, so leaving them in place is also safe.)

ALTER TABLE public.health_fix_queue
  ADD COLUMN linear_identifier text,
  ADD COLUMN ticketed_at timestamptz;

ALTER TABLE public.health_fix_queue
  ADD CONSTRAINT health_fix_queue_linear_identifier_check
    CHECK (linear_identifier IS NULL OR btrim(linear_identifier) <> '');

-- CRITICAL BACKFILL. Every row currently in an active status is already
-- represented by the historical rolling ticket (DEV-1231). Without this, the
-- first run after deploy mints one digest ticket carrying the entire existing
-- ~37-item backlog. The active-status set matches
-- health_fix_queue_active_fingerprint_idx (everything except 'fixed'/'skipped').
UPDATE public.health_fix_queue
  SET ticketed_at = now()
  WHERE ticketed_at IS NULL
    AND status NOT IN ('fixed', 'skipped');

-- Supports the "needs a ticket" lookup: active rows with no ticket yet,
-- probed by fingerprint. Mirrors the partial-index style of
-- health_fix_queue_claim_idx / health_fix_queue_active_fingerprint_idx.
CREATE INDEX health_fix_queue_unticketed_idx
  ON public.health_fix_queue (fingerprint, created_at DESC)
  WHERE ticketed_at IS NULL
    AND status IN (
      'pending',
      'claimed',
      'pr_opened',
      'awaiting_human',
      'merged',
      'deployed',
      'failed',
      'needs_human'
    );
