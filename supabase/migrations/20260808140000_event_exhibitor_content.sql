-- Roster-owned content for uncurated exhibitors (DEV-1396).
--
-- 125 of the 2026 Creative Expo's 307 exhibitors have no Formoria brand, so the
-- roster renders half a floor guide: a monogram, a booth, and the area label
-- where a listed brand shows a blurb. These columns let an exhibitor carry its
-- own thumbnail and one-line summary without being approved into the directory.
--
-- The deliberate choice here (DEV-1395) is that the ROSTER owns this content.
-- brand_submissions is only the enrichment vehicle: its output is copied onto
-- these columns, and the storage object is copied to an event-exhibitors/ path,
-- so no submission lifecycle event — rejection, bulk needs-data drop, or the
-- seven-day retention reaper — can blank what a visitor sees.
--
-- Every column is nullable. An exhibitor without enrichment keeps the existing
-- monogram + area-label rendering, which is also the fallback if content is
-- ever cleared.

alter table public.event_exhibitors
  add column image_url text
    check (image_url is null or image_url ~* '^https?://'),
  add column image_storage_path text,
  add column image_alt_zh text,
  add column image_alt_en text,
  add column summary_zh text,
  add column summary_en text,
  add column content_source text
    check (content_source is null or content_source in ('enriched')),
  add column content_verified_at timestamptz,
  add column content_submission_id uuid
    references public.brand_submissions (id) on delete set null;

-- One submission backs at most one exhibitor. This is the backstop for the
-- seeding script's own idempotency guard; createSubmission has no uniqueness
-- constraint of its own, so a re-run would otherwise mint duplicate rows.
create unique index event_exhibitors_content_submission_unique_idx
  on public.event_exhibitors (content_submission_id)
  where content_submission_id is not null;

-- Lets the storage maintenance sweep resolve an event-exhibitors/ object back
-- to its owning row instead of classifying it as untracked and purging it.
create index event_exhibitors_image_storage_path_idx
  on public.event_exhibitors (image_storage_path)
  where image_storage_path is not null;

comment on column public.event_exhibitors.image_url is
  'Public URL of the roster-owned thumbnail. Copied from enrichment output, never referenced from the submission, so it survives rejection of the submission it came from.';
comment on column public.event_exhibitors.image_storage_path is
  'Storage key in the brand-images bucket under the event-exhibitors/ prefix. Read by the storage maintenance sweep to keep the object out of the untracked purge category.';
comment on column public.event_exhibitors.summary_zh is
  'One-line description shown in place of the area label. AI-generated for an unvetted business: rendered for humans, deliberately kept out of JSON-LD and llms.txt.';
comment on column public.event_exhibitors.content_source is
  'Provenance of the roster-owned content. Only enrichment writes it today.';
comment on column public.event_exhibitors.content_submission_id is
  'Provenance and re-run idempotency key ONLY. The render path must never read through this column: on delete set null exists so a deleted submission cannot blank a thumbnail, which only holds because image_url and summary_* are independent copies.';
