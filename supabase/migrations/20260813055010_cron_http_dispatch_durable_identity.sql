-- DEV-1456 -- make pg_net HTTP cron dispatch attribution survive a database
-- restart. pg_net's request-id sequence is not durable, while both tables
-- historically used that value as their primary key. A restarted database can
-- therefore reuse an id and either reject the dispatch or overwrite an older
-- outcome during snapshotting.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Give every dispatch an identity owned by the durable public table.
-- ---------------------------------------------------------------------------
-- request_id remains the correlation value for net._http_response, but it is
-- deliberately no longer unique. The existing rows get one generated id each;
-- future cron INSERTs inherit the default without changing their SQL bodies.
ALTER TABLE public.cron_http_dispatch
  ADD COLUMN dispatch_id uuid DEFAULT gen_random_uuid();

ALTER TABLE public.cron_http_dispatch
  ALTER COLUMN dispatch_id SET NOT NULL;

ALTER TABLE public.cron_http_dispatch
  DROP CONSTRAINT IF EXISTS cron_http_dispatch_pkey;

ALTER TABLE public.cron_http_dispatch
  ADD CONSTRAINT cron_http_dispatch_pkey PRIMARY KEY (dispatch_id);

CREATE INDEX IF NOT EXISTS cron_http_dispatch_request_id_dispatched_at_idx
  ON public.cron_http_dispatch (request_id, dispatched_at DESC);

COMMENT ON COLUMN public.cron_http_dispatch.dispatch_id IS
  'DEV-1456: durable identity for this dispatch; request_id belongs to pg_net and can reset after a database restart.';

-- ---------------------------------------------------------------------------
-- 2. Preserve existing outcomes under the dispatch identity.
-- ---------------------------------------------------------------------------
-- Before this migration request_id was unique, so the join below maps every
-- existing log row back to the dispatch that produced it. The fallback keeps a
-- durable outcome even if an operator already removed its dispatch row.
ALTER TABLE public.cron_http_log
  ADD COLUMN dispatch_id uuid;

UPDATE public.cron_http_log AS log
SET dispatch_id = dispatch.dispatch_id
FROM public.cron_http_dispatch AS dispatch
WHERE dispatch.request_id = log.request_id;

UPDATE public.cron_http_log
SET dispatch_id = gen_random_uuid()
WHERE dispatch_id IS NULL;

ALTER TABLE public.cron_http_log
  ALTER COLUMN dispatch_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN dispatch_id SET NOT NULL;

ALTER TABLE public.cron_http_log
  DROP CONSTRAINT IF EXISTS cron_http_log_pkey;

ALTER TABLE public.cron_http_log
  ADD CONSTRAINT cron_http_log_pkey PRIMARY KEY (dispatch_id);

COMMENT ON COLUMN public.cron_http_log.dispatch_id IS
  'DEV-1456: durable identity of the dispatch whose pg_net outcome was snapshotted.';

-- ---------------------------------------------------------------------------
-- 3. Snapshot each response against the newest eligible dispatch.
-- ---------------------------------------------------------------------------
-- A reused request id can join more than one durable dispatch. A response is
-- eligible only when pg_net recorded it at or after the dispatch time; among
-- those candidates, the newest dispatch owns the response. Conflict handling
-- is keyed by dispatch_id, so a later dispatch can never replace an older
-- durable outcome even when request_id is reused.
DO $$ BEGIN
  PERFORM cron.unschedule('cron-http-snapshot');
EXCEPTION WHEN others THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cron-http-snapshot',
  '*/15 * * * *',
  $job$
  WITH eligible AS (
    SELECT
      dispatch.dispatch_id,
      dispatch.request_id,
      dispatch.job_name,
      response.status_code,
      coalesce(response.timed_out, false) AS timed_out,
      response.error_msg,
      response.created,
      row_number() OVER (
        PARTITION BY response.id
        ORDER BY dispatch.dispatched_at DESC, dispatch.dispatch_id DESC
      ) AS dispatch_rank
    FROM public.cron_http_dispatch AS dispatch
    JOIN net._http_response AS response
      ON response.id = dispatch.request_id
     AND response.created >= dispatch.dispatched_at
  )
  INSERT INTO public.cron_http_log (
    dispatch_id,
    request_id,
    job_name,
    status_code,
    timed_out,
    error_msg,
    created
  )
  SELECT
    dispatch_id,
    request_id,
    job_name,
    status_code,
    timed_out,
    error_msg,
    created
  FROM eligible
  WHERE dispatch_rank = 1
  ON CONFLICT (dispatch_id) DO UPDATE SET
    status_code = excluded.status_code,
    timed_out   = excluded.timed_out,
    error_msg   = excluded.error_msg,
    created     = excluded.created,
    logged_at   = now();
  $job$
);

COMMIT;
