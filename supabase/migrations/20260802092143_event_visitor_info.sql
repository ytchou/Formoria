-- Applied directly to production on 2026-08-02 and stamped in
-- supabase_migrations.schema_migrations as version 20260802092143; the
-- statements below match that ledger entry verbatim.
--
-- Visitor-decision fields for public.events. These four localized pairs carry
-- the facts a visitor needs BEFORE travelling: which days are open to whom, how
-- to get in, how to arrive, and where the brand lineup came from. They existed
-- only as prose inside `description`, where the facts rail could not surface
-- them — a reader who saw "2026/08/06-08/12" and arrived on 8/6 was turned away
-- at the door, because 8/6-8/7 are trade-buyer-only days.
--
-- All eight are nullable with no default: every event other than the 2026
-- Creative Expo has them null, so every render path treats absence as normal
-- rather than as missing data. No check constraint either — these are editorial
-- prose fields, and a length cap would silently truncate a legitimate schedule.

alter table public.events
  -- Multi-line (newline-separated): one line per day-band, because opening
  -- hours differ per day and a single paragraph hides the trade-only band.
  add column schedule_note text,
  add column schedule_note_en text,
  add column admission_note text,
  add column admission_note_en text,
  add column travel_note text,
  add column travel_note_en text,
  add column lineup_note text,
  add column lineup_note_en text;

comment on column public.events.schedule_note is
  'Per-day opening hours and audience restrictions. Newline-separated, one line per day band; rendered with whitespace-pre-line.';
comment on column public.events.admission_note is
  'How to get in: free vs ticketed mechanics, reservation vs walk-up queue, slot quotas.';
comment on column public.events.travel_note is
  'Getting there: transit lines and station, parking capacity and hours.';
comment on column public.events.lineup_note is
  'Provenance of the brand lineup and the "exhibiting is not an endorsement" disclaimer. Rendered as a caption under the lineup heading.';
