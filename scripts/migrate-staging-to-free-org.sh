#!/usr/bin/env bash
# migrate-staging-to-free-org.sh
#
# Migrates Formoria Staging from the Pro org to a new free org.
#
# What this script does:
#   1. Creates a new free org
#   2. Creates a new free-tier project in it
#   3. Dumps schema + data from current staging
#   4. Pushes schema to new project
#   5. Restores data to new project
#   6. Copies Storage buckets (structure only — files migrated separately)
#   7. Prints new credentials and a list of places to update
#
# What you must do manually after:
#   - Update .env.staging with new credentials
#   - Update Railway staging environment variables
#   - Update GitHub Actions secrets (if any reference staging)
#   - Configure Auth providers (Google, etc.) in new project dashboard
#   - Verify Storage bucket policies match
#
# Usage: bash scripts/migrate-staging-to-free-org.sh

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────
OLD_ORG_ID="ycfoiezbgijmqstekamm"
OLD_STAGING_REF="xwkigpvnheecihpxyvsl"
NEW_ORG_NAME="Formoria Free"
NEW_PROJECT_NAME="Formoria Staging"
REGION="ap-northeast-1"
DUMP_DIR="$(mktemp -d)/staging-migration-$(date +%Y%m%d-%H%M%S)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ Step $1: $2 ━━━${NC}"; }

# ── Preflight ───────────────────────────────────────────────────────────
step 0 "Preflight checks"

command -v supabase >/dev/null 2>&1 || fail "supabase CLI not found"
command -v psql >/dev/null 2>&1     || fail "psql not found (brew install libpq)"
command -v pg_dump >/dev/null 2>&1  || fail "pg_dump not found (brew install libpq)"
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found (brew install libpq)"

# Verify we can reach the old staging project
info "Verifying access to old staging project ${OLD_STAGING_REF}..."
OLD_STAGING_DB_URL=$(grep '^SUPABASE_DB_URL=' .env.staging | cut -d= -f2-)
if [ -z "$OLD_STAGING_DB_URL" ]; then
  fail "Cannot read SUPABASE_DB_URL from .env.staging"
fi
psql "$OLD_STAGING_DB_URL" -c "SELECT 1" >/dev/null 2>&1 || fail "Cannot connect to old staging database"
ok "Connected to old staging database"

# Check DB size fits free-tier 500MB cap
DB_SIZE_MB=$(psql "$OLD_STAGING_DB_URL" -t -A -c "SELECT pg_database_size(current_database()) / 1024 / 1024;" 2>/dev/null)
info "Current staging DB size: ${DB_SIZE_MB}MB (free-tier cap: 500MB)"
if [ "${DB_SIZE_MB:-0}" -gt 400 ]; then
  fail "Database is ${DB_SIZE_MB}MB — too close to the 500MB free-tier cap. Strip data first or stay on Pro."
fi
ok "DB size ${DB_SIZE_MB}MB is within free-tier limits"

# Verify bootstrap files exist
for f in supabase/bootstrap/staging.sql supabase/bootstrap/normalize-hosted-schema.sql supabase/bootstrap/deactivate-staging-cron.sql; do
  [ -f "$f" ] || fail "Missing required bootstrap file: $f"
done
ok "Bootstrap files present"

mkdir -p "$DUMP_DIR"
info "Dump directory: $DUMP_DIR"

# ── Step 1: Create new free org ─────────────────────────────────────────
step 1 "Create new free org"

info "Creating org '${NEW_ORG_NAME}'..."
NEW_ORG_OUTPUT=$(supabase orgs create "$NEW_ORG_NAME" --output-format json 2>&1) || {
  echo "$NEW_ORG_OUTPUT"
  fail "Failed to create org. You may need to create it manually at https://supabase.com/dashboard"
}
echo "$NEW_ORG_OUTPUT"

NEW_ORG_ID=$(echo "$NEW_ORG_OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
# Handle both possible response shapes
if isinstance(data, dict):
    print(data.get('id', data.get('slug', '')))
elif isinstance(data, str):
    print(data)
" 2>/dev/null || echo "")

if [ -z "$NEW_ORG_ID" ]; then
  warn "Could not parse org ID from output. Listing orgs to find it..."
  supabase orgs list --output-format json
  echo ""
  read -rp "Enter the new org ID/slug from the list above: " NEW_ORG_ID
fi
ok "New org created: ${NEW_ORG_ID}"

# ── Step 2: Create new project ──────────────────────────────────────────
step 2 "Create new free-tier project"

DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)

info "Creating project '${NEW_PROJECT_NAME}' in org ${NEW_ORG_ID}..."
info "Generated DB password (save this): ${DB_PASSWORD}"

NEW_PROJECT_OUTPUT=$(supabase projects create "$NEW_PROJECT_NAME" \
  --org-id "$NEW_ORG_ID" \
  --db-password "$DB_PASSWORD" \
  --region "$REGION" \
  --output-format json 2>&1) || {
  echo "$NEW_PROJECT_OUTPUT"
  fail "Failed to create project"
}
echo "$NEW_PROJECT_OUTPUT"

NEW_REF=$(echo "$NEW_PROJECT_OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, dict):
    print(data.get('ref', data.get('id', '')))
" 2>/dev/null || echo "")

if [ -z "$NEW_REF" ]; then
  warn "Could not parse project ref from output."
  read -rp "Enter the new project ref: " NEW_REF
fi
ok "New project ref: ${NEW_REF}"

# Wait for project to be ready
info "Waiting for project to become healthy (this can take 1-2 minutes)..."
for i in $(seq 1 30); do
  STATUS=$(supabase projects list --output-format json 2>/dev/null | python3 -c "
import sys, json
projects = json.load(sys.stdin)
if isinstance(projects, dict):
    projects = projects.get('projects', [])
for p in projects:
    if p.get('ref') == '${NEW_REF}':
        print(p.get('status', 'UNKNOWN'))
        break
" 2>/dev/null || echo "UNKNOWN")

  if [ "$STATUS" = "ACTIVE_HEALTHY" ]; then
    ok "Project is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Project did not become healthy after 5 minutes. Check dashboard."
  fi
  echo -n "."
  sleep 10
done

# ── Step 3: Get new project credentials ─────────────────────────────────
step 3 "Retrieve new project credentials"

info "Fetching API keys for ${NEW_REF}..."
NEW_KEYS=$(supabase projects api-keys --project-ref "$NEW_REF" --output-format json 2>&1)
echo "$NEW_KEYS" > "$DUMP_DIR/new-api-keys.json"

NEW_ANON_KEY=$(echo "$NEW_KEYS" | python3 -c "
import sys, json
keys = json.load(sys.stdin)
if isinstance(keys, list):
    for k in keys:
        if k.get('name') == 'anon':
            print(k['api_key'])
            break
elif isinstance(keys, dict):
    items = keys.get('keys', keys.get('data', []))
    for k in items:
        if k.get('name') == 'anon':
            print(k['api_key'])
            break
" 2>/dev/null || echo "")

NEW_SERVICE_KEY=$(echo "$NEW_KEYS" | python3 -c "
import sys, json
keys = json.load(sys.stdin)
if isinstance(keys, list):
    for k in keys:
        if k.get('name') == 'service_role':
            print(k['api_key'])
            break
elif isinstance(keys, dict):
    items = keys.get('keys', keys.get('data', []))
    for k in items:
        if k.get('name') == 'service_role':
            print(k['api_key'])
            break
" 2>/dev/null || echo "")

NEW_SUPABASE_URL="https://${NEW_REF}.supabase.co"
NEW_DB_URL="postgresql://postgres.${NEW_REF}:${DB_PASSWORD}@aws-0-${REGION}.pooler.supabase.com:5432/postgres"

if [ -z "$NEW_ANON_KEY" ] || [ -z "$NEW_SERVICE_KEY" ]; then
  warn "Could not parse API keys automatically."
  warn "Check $DUMP_DIR/new-api-keys.json and enter manually."
  read -rp "Anon key: " NEW_ANON_KEY
  read -rp "Service role key: " NEW_SERVICE_KEY
fi

ok "Credentials retrieved"

# ── Step 4: Dump old staging schema + data ──────────────────────────────
step 4 "Dump old staging database"

info "Dumping schema (DDL)..."
pg_dump "$OLD_STAGING_DB_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file="$DUMP_DIR/schema.sql" 2>&1 || fail "Schema dump failed"
ok "Schema dumped to $DUMP_DIR/schema.sql"

info "Dumping data..."
pg_dump "$OLD_STAGING_DB_URL" \
  --schema=public \
  --data-only \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="$DUMP_DIR/data.dump" 2>&1 || fail "Data dump failed"
ok "Data dumped to $DUMP_DIR/data.dump"

# Also dump extensions and custom types
info "Dumping extensions list..."
psql "$OLD_STAGING_DB_URL" -t -A -c "
  SELECT 'CREATE EXTENSION IF NOT EXISTS \"' || extname || '\" WITH SCHEMA \"' || nspname || '\";'
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
  WHERE extname NOT IN ('plpgsql')
  ORDER BY extname;
" > "$DUMP_DIR/extensions.sql" 2>&1
ok "Extensions list saved"

# Dump storage bucket definitions
info "Dumping storage bucket definitions..."
psql "$OLD_STAGING_DB_URL" -t -A -c "
  SELECT json_agg(json_build_object(
    'id', id,
    'name', name,
    'public', public,
    'file_size_limit', file_size_limit,
    'allowed_mime_types', allowed_mime_types
  ))
  FROM storage.buckets;
" > "$DUMP_DIR/storage-buckets.json" 2>&1
ok "Storage bucket definitions saved"

# Dump RPC functions
info "Dumping custom functions..."
pg_dump "$OLD_STAGING_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --section=pre-data \
  --file="$DUMP_DIR/functions.sql" 2>&1 || warn "Function dump had issues"
ok "Functions dumped"

# ── Step 5: Push schema to new project ──────────────────────────────────
step 5 "Apply schema to new project"

info "Testing connection to new database..."
psql "$NEW_DB_URL" -c "SELECT 1" >/dev/null 2>&1 || fail "Cannot connect to new database at $NEW_DB_URL"
ok "Connected to new database"

info "Installing extensions..."
psql "$NEW_DB_URL" -f "$DUMP_DIR/extensions.sql" 2>&1 || warn "Some extensions may have failed (this is normal for built-in ones)"

info "Applying schema..."
psql "$NEW_DB_URL" -f "$DUMP_DIR/schema.sql" 2>&1 || {
  warn "Schema apply had errors. This may be normal for pre-existing Supabase objects."
  warn "Review the output above. Critical errors will show as 'ERROR' lines."
  read -rp "Continue anyway? (y/n) " CONTINUE
  [ "$CONTINUE" = "y" ] || fail "Aborted by user"
}
ok "Schema applied"

# ── Step 6: Restore data ────────────────────────────────────────────────
step 6 "Restore data to new project"

info "Restoring data..."
pg_restore "$DUMP_DIR/data.dump" \
  --dbname="$NEW_DB_URL" \
  --data-only \
  --no-owner \
  --no-privileges \
  --schema=public 2>&1 || {
  warn "Data restore had some errors (constraint violations on existing rows are normal)"
}
ok "Data restored"

# Verify row counts
info "Verifying row counts..."
echo "Old staging:"
psql "$OLD_STAGING_DB_URL" -c "
  SELECT schemaname, relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
  ORDER BY n_live_tup DESC
  LIMIT 15;
" 2>&1

echo ""
echo "New staging:"
psql "$NEW_DB_URL" -c "
  SELECT schemaname, relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
  ORDER BY n_live_tup DESC
  LIMIT 15;
" 2>&1

# ── Step 6b: Run bootstrap files ────────────────────────────────────────
info "Running bootstrap: staging.sql (health_agent roles + app_secrets)..."
psql "$NEW_DB_URL" -f supabase/bootstrap/staging.sql 2>&1 || warn "staging.sql had issues"
ok "Bootstrap staging.sql applied"

info "Running bootstrap: normalize-hosted-schema.sql (RLS for health agent)..."
psql "$NEW_DB_URL" -f supabase/bootstrap/normalize-hosted-schema.sql 2>&1 || warn "normalize-hosted-schema.sql had issues"
ok "Bootstrap normalize-hosted-schema.sql applied"

info "Running bootstrap: deactivate-staging-cron.sql..."
psql "$NEW_DB_URL" -f supabase/bootstrap/deactivate-staging-cron.sql 2>&1 || warn "deactivate-staging-cron.sql had issues"
ok "All cron jobs deactivated"

# Apply staging fixtures
if [ -f supabase/fixtures/staging.sql ]; then
  info "Applying staging fixtures..."
  psql "$NEW_DB_URL" -f supabase/fixtures/staging.sql 2>&1 || warn "Staging fixtures had issues"
  ok "Staging fixtures applied"
fi

# Verify SECURITY DEFINER functions have correct ownership
info "Checking SECURITY DEFINER functions..."
SECDEF_COUNT=$(psql "$NEW_DB_URL" -t -A -c "
  SELECT count(*)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef = true;
" 2>/dev/null)
info "Found ${SECDEF_COUNT} SECURITY DEFINER functions in public schema"

# Verify cron jobs are deactivated
ACTIVE_CRON=$(psql "$NEW_DB_URL" -t -A -c "SELECT count(*) FROM cron.job WHERE active;" 2>/dev/null || echo "N/A")
if [ "$ACTIVE_CRON" = "0" ]; then
  ok "All cron jobs confirmed deactivated"
elif [ "$ACTIVE_CRON" = "N/A" ]; then
  warn "Could not check cron jobs (pg_cron may not be installed yet)"
else
  warn "${ACTIVE_CRON} cron jobs still active — run deactivate-staging-cron.sql manually"
fi

# ── Step 7: Recreate storage buckets ────────────────────────────────────
step 7 "Recreate storage buckets"

BUCKETS=$(cat "$DUMP_DIR/storage-buckets.json" 2>/dev/null)
if [ -n "$BUCKETS" ] && [ "$BUCKETS" != "null" ] && [ "$BUCKETS" != "" ]; then
  info "Creating storage buckets in new project..."
  echo "$BUCKETS" | python3 -c "
import sys, json, subprocess

buckets = json.load(sys.stdin)
if not buckets:
    print('No buckets to create')
    sys.exit(0)

for b in buckets:
    name = b['id']
    public = b.get('public', False)
    print(f\"  Creating bucket: {name} (public={public})\")
    # We'll output SQL to create them
    public_str = 'true' if public else 'false'
    size_limit = b.get('file_size_limit') or 'NULL'
    mime_types = b.get('allowed_mime_types')
    mime_str = \"'{\" + ','.join(f'\"{m}\"' for m in mime_types) + \"}'\" if mime_types else 'NULL'
    print(f\"    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\")
    print(f\"    VALUES ('{name}', '{name}', {public_str}, {size_limit}, {mime_str})\")
    print(f\"    ON CONFLICT (id) DO NOTHING;\")
" > "$DUMP_DIR/create-buckets.sql" 2>&1

  # Extract just the SQL lines
  grep -E '^\s+(INSERT|VALUES|ON CONFLICT)' "$DUMP_DIR/create-buckets.sql" > "$DUMP_DIR/buckets-insert.sql" 2>/dev/null || true
  if [ -s "$DUMP_DIR/buckets-insert.sql" ]; then
    psql "$NEW_DB_URL" -f "$DUMP_DIR/buckets-insert.sql" 2>&1 || warn "Some bucket creation failed"
  fi
  ok "Storage buckets recreated (structure only — files not migrated)"
else
  info "No storage buckets found in old staging"
fi

# ── Step 8: Set up keepalive ────────────────────────────────────────────
step 8 "Generate keepalive cron (prevents 7-day pause)"

cat > "$DUMP_DIR/keepalive.yml" << 'KEEPALIVE_EOF'
# .github/workflows/supabase-staging-keepalive.yml
# Pings the free-tier staging database every 5 days to prevent auto-pause.
name: Supabase Staging Keepalive

on:
  schedule:
    - cron: '0 0 */5 * *'  # Every 5 days at midnight UTC
  workflow_dispatch: {}

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping staging database
        env:
          SUPABASE_DB_URL: ${{ secrets.STAGING_SUPABASE_DB_URL }}
        run: |
          psql "$SUPABASE_DB_URL" -c "SELECT 1 AS keepalive, now() AS pinged_at;"
KEEPALIVE_EOF

ok "Keepalive workflow saved to $DUMP_DIR/keepalive.yml"
info "Copy it to .github/workflows/ and add STAGING_SUPABASE_DB_URL to GitHub Secrets"

# ── Step 9: Summary ────────────────────────────────────────────────────
step 9 "Migration summary"

cat << SUMMARY

${GREEN}════════════════════════════════════════════════════════════════${NC}
${GREEN}  MIGRATION COMPLETE — New Staging Project Credentials${NC}
${GREEN}════════════════════════════════════════════════════════════════${NC}

  New Org ID:            ${NEW_ORG_ID}
  New Project Ref:       ${NEW_REF}
  New Supabase URL:      ${NEW_SUPABASE_URL}
  New DB URL:            ${NEW_DB_URL}

  Dump files saved to:   ${DUMP_DIR}

${YELLOW}════════════════════════════════════════════════════════════════${NC}
${YELLOW}  YOU MUST DO THESE MANUALLY:${NC}
${YELLOW}════════════════════════════════════════════════════════════════${NC}

  1. UPDATE .env.staging with new values:
     ┌──────────────────────────────────────────────────────────────┐
     │ SUPABASE_PROJECT_REF=${NEW_REF}
     │ NEXT_PUBLIC_SUPABASE_URL=${NEW_SUPABASE_URL}
     │ SUPABASE_DB_URL=${NEW_DB_URL}
     │ NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEW_ANON_KEY}
     │ SUPABASE_SERVICE_ROLE_KEY=${NEW_SERVICE_KEY}
     └──────────────────────────────────────────────────────────────┘

  2. UPDATE src/lib/supabase/project-target.ts:
     Change STAGING_PROJECT_REF from "${OLD_STAGING_REF}" to "${NEW_REF}"

  3. UPDATE these files that hardcode the old ref:
     - scripts/db-deploy.test.ts
     - scripts/backfill-tw-localization.test.ts
     - scripts/doctor.test.ts

  4. UPDATE Railway staging environment variables:
     Same values as .env.staging above

  5. UPDATE GitHub Secrets (environment-scoped):
     Environment "Formoria / staging" (Settings → Environments):
     - SUPABASE_PROJECT_REF=${NEW_REF}
     - SUPABASE_DB_URL=${NEW_DB_URL}
     - NEXT_PUBLIC_SUPABASE_URL=${NEW_SUPABASE_URL}
     - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEW_ANON_KEY}
     - SUPABASE_SERVICE_ROLE_KEY=${NEW_SERVICE_KEY}

     Repo-level secret (Settings → Secrets → Actions):
     - STAGING_SUPABASE_DB_URL=${NEW_DB_URL}  (for keepalive workflow)

     ⚠️  DO NOT touch "Formoria / production" environment secrets.

  6. CONFIGURE Auth providers in new project dashboard:
     https://supabase.com/dashboard/project/${NEW_REF}/auth/providers
     (Google OAuth, email settings, etc. — these don't migrate)

  7. MIGRATE Storage files (if any):
     Download from old project, upload to new project via dashboard

  8. INSTALL the keepalive workflow:
     cp ${DUMP_DIR}/keepalive.yml .github/workflows/supabase-staging-keepalive.yml

  9. DELETE old staging project (after verifying everything works):
     supabase projects delete --ref ${OLD_STAGING_REF}

${GREEN}════════════════════════════════════════════════════════════════${NC}

SUMMARY

# Save credentials to a file for reference
cat > "$DUMP_DIR/new-credentials.env" << CREDS_EOF
# New Formoria Staging credentials — generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# DELETE THIS FILE after updating all environments
SUPABASE_PROJECT_REF=${NEW_REF}
NEXT_PUBLIC_SUPABASE_URL=${NEW_SUPABASE_URL}
SUPABASE_DB_URL=${NEW_DB_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEW_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${NEW_SERVICE_KEY}
DB_PASSWORD=${DB_PASSWORD}
CREDS_EOF

ok "Credentials also saved to $DUMP_DIR/new-credentials.env (delete after use)"
