# Deferred migrations

SQL in this directory is **not** applied by `supabase db push`. It lives outside
`supabase/migrations/` on purpose: each file is complete and reviewed, but
switching it on has a consequence that has not been approved yet.

To apply one, move it into `supabase/migrations/` (keeping its timestamp, or
renaming to a current one if later migrations have since landed), then push
normally.

Every file here needs a stated unblocking condition. "Deferred" with no trigger
is how the last one stayed invisible for a week (DEV-1378) — an entry without an
**Unblocks when** is a bug in the entry, not a note for later.

| File | Why it is held | Unblocks when |
|---|---|---|
| _(none)_ | | |

Applied and removed:

- `20260801140000_schedule_classifier_retention_cron.sql` — held because
  scheduling it begins irreversible storage deletion of rejected images 7 days
  after they are marked. Both gates closed by DEV-1378 (DEV-1279 settled that
  the reaper is the single deletion path; the orphaned-row population was
  re-counted and swept). Now
  `supabase/migrations/20260808130000_schedule_classifier_retention_cron.sql`.
