#!/usr/bin/env bash
set -euo pipefail

is_allowed_pg_net_schema_diff() {
  local normalized_diff
  normalized_diff=$(
    printf '%s' "$1" |
      sed -E '/^[[:space:]]*--.*$/d' |
      tr $'\r\n\t' '   ' |
      sed -E 's/[[:space:]]*;[[:space:]]*/; /g; s/[[:space:]]+/ /g; s/^ //; s/ $//'
  )
  [[ "$normalized_diff" == "DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA public;" ]]
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
replay_root=$(mktemp -d "${TMPDIR:-/tmp}/formoria-db-replay.XXXXXX")
replay_name=${replay_root##*/}
replay_suffix=${replay_name#formoria-db-replay.}
if [[ -z "$replay_suffix" || "$replay_suffix" == *[![:alnum:]]* ]]; then
  echo "Could not derive a safe replay project suffix from $replay_root" >&2
  exit 1
fi
replay_project_id="formoria-db-replay-${replay_suffix}"

# Audited production-data-only migrations. They intentionally have no schema
# changes and require rows that exist only in the production data set.
# Keep this allowlist explicit; do not replace it with a glob or filename filter.
audited_data_only_migrations=(
  "20260804150000_reapply_unigaze_merge_due_timestamp_collision.sql"
  "20260811070416_apply_reviewed_link_corrections.sql"
)

cleanup() {
  case "$replay_root" in
    "${TMPDIR:-/tmp}"/formoria-db-replay.*)
      pnpm --dir "$repo_root" exec supabase stop --workdir "$replay_root" --no-backup >/dev/null 2>&1 || true
      rm -rf "$replay_root"
      ;;
    *) echo "Refusing to remove unexpected replay path: $replay_root" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM HUP

cp -R "$repo_root/supabase" "$replay_root/supabase"
mv "$replay_root/supabase/migrations" "$replay_root/supabase/migrations.pending"
sed -i.bak \
  -e "s/^project_id = .*/project_id = \"$replay_project_id\"/" \
  -e '$a\
[db.seed]\
enabled = false' \
  "$replay_root/supabase/config.toml"
rm "$replay_root/supabase/config.toml.bak"

pnpm --dir "$repo_root" exec supabase start \
  --workdir "$replay_root" \
  --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

local_db_url=$(
  pnpm --dir "$repo_root" exec supabase status --workdir "$replay_root" -o env |
    sed -n 's/^DB_URL=//p' |
    sed -e "s/^['\"]//" -e "s/['\"]$//"
)
if [[ -z "$local_db_url" ]]; then
  echo "Could not resolve the temporary local Supabase DB URL" >&2
  exit 1
fi

psql --dbname "$local_db_url" --set ON_ERROR_STOP=1 \
  --file "$replay_root/supabase/bootstrap/staging.sql"
mv "$replay_root/supabase/migrations.pending" "$replay_root/supabase/migrations"

expected=$(find "$replay_root/supabase/migrations" -type f -name '*.sql' | wc -l | tr -d ' ')
# Keep these files in place: migration repair requires the matching local files
# to exist while it records their production-only versions as applied.
for migration_file in "${audited_data_only_migrations[@]}"; do
  migration_path="$replay_root/supabase/migrations/$migration_file"
  if [[ ! -f "$migration_path" ]]; then
    echo "Audited data-only migration is missing from the temporary copy: $migration_file" >&2
    exit 1
  fi
  migration_version=${migration_file%%_*}
  pnpm --dir "$repo_root" exec supabase migration repair \
    --local --status applied "$migration_version" --workdir "$replay_root"
done

pnpm --dir "$repo_root" exec supabase migration up --local --include-all --workdir "$replay_root"
psql --dbname "$local_db_url" --set ON_ERROR_STOP=1 \
  --file "$replay_root/supabase/bootstrap/normalize-hosted-schema.sql"
psql --dbname "$local_db_url" --set ON_ERROR_STOP=1 \
  --file "$replay_root/supabase/bootstrap/deactivate-staging-cron.sql"

ledger=$(
  psql --dbname "$local_db_url" --set ON_ERROR_STOP=1 \
    --tuples-only --no-align \
    --command "select count(*) from supabase_migrations.schema_migrations;" |
    tr -d '[:space:]'
)
if [[ "$ledger" != "$expected" ]]; then
  echo "Fresh replay ledger did not contain ${expected} migrations" >&2
  exit 1
fi

cron=$(
  psql --dbname "$local_db_url" --set ON_ERROR_STOP=1 \
    --tuples-only --no-align \
    --command "select count(*) from cron.job where active;" |
    tr -d '[:space:]'
)
if [[ "$cron" != "0" ]]; then
  echo "Fresh replay left active cron jobs" >&2
  exit 1
fi

pnpm --dir "$repo_root" exec supabase gen types typescript \
  --db-url "$local_db_url" \
  > "$replay_root/database.types.ts"
node -e '
  const fs = require("node:fs");
  const [committed, generated] = process.argv.slice(1).map((file) =>
    fs.readFileSync(file, "utf8").trim(),
  );
  if (committed !== generated) process.exit(1);
' "$repo_root/src/lib/supabase/database.types.ts" "$replay_root/database.types.ts"

if [[ -n "${FORMORIA_COMPARE_DB_URL:-}" ]]; then
  schema_diff=$(
    pnpm --dir "$repo_root" exec supabase --agent no --output-format text db diff \
      --from "$local_db_url" \
      --to "$FORMORIA_COMPARE_DB_URL" \
      --use-pg-schema
  )
  if [[ -n "${schema_diff//[[:space:]]/}" ]] &&
    ! is_allowed_pg_net_schema_diff "$schema_diff"; then
    echo "Repository-to-database schema drift detected" >&2
    printf '%s\n' "$schema_diff" >&2
    exit 1
  fi
fi
