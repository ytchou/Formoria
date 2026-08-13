#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
replay_root=$(mktemp -d "${TMPDIR:-/tmp}/formoria-db-replay.XXXXXX")

cleanup() {
  pnpm --dir "$repo_root" exec supabase stop --workdir "$replay_root" >/dev/null 2>&1 || true
  case "$replay_root" in
    "${TMPDIR:-/tmp}"/formoria-db-replay.*) rm -rf "$replay_root" ;;
    *) echo "Refusing to remove unexpected replay path: $replay_root" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM HUP

cp -R "$repo_root/supabase" "$replay_root/supabase"
mv "$replay_root/supabase/migrations" "$replay_root/supabase/migrations.pending"
sed -i.bak 's/^project_id = .*/project_id = "formoria-db-replay"/' "$replay_root/supabase/config.toml"
rm "$replay_root/supabase/config.toml.bak"

pnpm --dir "$repo_root" exec supabase start --workdir "$replay_root"
pnpm --dir "$repo_root" exec supabase db query --local --workdir "$replay_root" \
  --file "$replay_root/supabase/bootstrap/staging.sql"
mv "$replay_root/supabase/migrations.pending" "$replay_root/supabase/migrations"
pnpm --dir "$repo_root" exec supabase migration up --local --include-all --workdir "$replay_root"
pnpm --dir "$repo_root" exec supabase db query --local --workdir "$replay_root" \
  --file "$replay_root/supabase/bootstrap/deactivate-staging-cron.sql"

expected=$(find "$replay_root/supabase/migrations" -type f -name '*.sql' | wc -l | tr -d ' ')
ledger=$(pnpm --dir "$repo_root" exec supabase db query --local --workdir "$replay_root" \
  "select count(*)::text as formoria_migration_count from supabase_migrations.schema_migrations;")
if ! grep -Eq "formoria_migration_count[[:space:]|:]+${expected}\b" <<<"$ledger"; then
  echo "Fresh replay ledger did not contain ${expected} migrations" >&2
  exit 1
fi

cron=$(pnpm --dir "$repo_root" exec supabase db query --local --workdir "$replay_root" \
  "select count(*)::text as formoria_active_cron from cron.job where active;")
if ! grep -Eq 'formoria_active_cron[[:space:]|:]+0\b' <<<"$cron"; then
  echo "Fresh replay left active cron jobs" >&2
  exit 1
fi

pnpm --dir "$repo_root" exec supabase gen types typescript --local --workdir "$replay_root" \
  > "$replay_root/database.types.ts"
cmp "$repo_root/src/lib/supabase/database.types.ts" "$replay_root/database.types.ts"
