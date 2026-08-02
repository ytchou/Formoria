-- Recovered from the remote migration ledger: this was applied directly to the
-- production database on 2026-08-02 and never committed, leaving the repo unable
-- to reproduce the schema. Content is verbatim from
-- supabase_migrations.schema_migrations.statements for version 20260802092143.
alter table public.events
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
