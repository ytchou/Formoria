# Deferred migrations

SQL in this directory is **not** applied by `supabase db push`. It lives outside
`supabase/migrations/` on purpose: each file is complete and reviewed, but
switching it on has a consequence that has not been approved yet.

To apply one, move it into `supabase/migrations/` (keeping its timestamp, or
renaming to a current one if later migrations have since landed), then push
normally.

| File | Why it is held | Unblocks when |
|---|---|---|
| `20260801140000_schedule_classifier_retention_cron.sql` | Scheduling it begins **irreversible storage deletion** of rejected images 7 days after they are marked. DEV-1279 has not settled whether classifier rejection should delete at all. | The decouple-deletion decision in DEV-1279 lands and the retention policy is final. |
