#!/bin/bash
set -e

echo "Formoria — Environment Doctor"
echo "================================"
echo ""

ERRORS=0

# ── Node.js ──────────────────────────────────────────────────────────────────
check_node() {
  if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Install via nvm or fnm."
    ERRORS=$((ERRORS + 1))
    return
  fi
  NODE_VERSION=$(node -v | sed 's/v//')
  REQUIRED="20.0.0"
  if [ "$(printf '%s\n' "$REQUIRED" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED" ]; then
    echo "ERROR: Node.js >= 20 required. Found: $NODE_VERSION"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: Node.js $NODE_VERSION"
  fi
}

# ── pnpm ─────────────────────────────────────────────────────────────────────
check_pnpm() {
  if ! command -v pnpm &> /dev/null; then
    echo "ERROR: pnpm not found. Install: npm install -g pnpm"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: pnpm $(pnpm -v)"
  fi
}

# ── Dependencies ─────────────────────────────────────────────────────────────
check_deps() {
  if [ ! -d "node_modules" ]; then
    echo "ERROR: node_modules missing. Run: pnpm install"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: Dependencies installed"
  fi
}

# ── Environment file ─────────────────────────────────────────────────────────
check_env() {
  if [ ! -f ".env.local" ]; then
    echo "ERROR: .env.local missing. Run: cp .env.example .env.local"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: .env.local exists"
    # Check critical vars
    if ! grep -q "NEXT_PUBLIC_SUPABASE_URL=https://" .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_SUPABASE_URL may not be set (check .env.local)"
    fi
    if ! grep -q "NEXT_PUBLIC_SUPABASE_ANON_KEY=ey" .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_SUPABASE_ANON_KEY may not be set (check .env.local)"
    fi
    if ! grep -q "SUPABASE_SERVICE_ROLE_KEY=." .env.local 2>/dev/null; then
      echo "WARN: SUPABASE_SERVICE_ROLE_KEY may not be set (required for maintenance scripts)"
    fi
    if ! grep -q "RESEND_API_KEY=" .env.local 2>/dev/null; then
      echo "WARN: RESEND_API_KEY may not be set (optional transactional owner emails will no-op)"
    fi
    if ! grep -q "NEXT_PUBLIC_SENTRY_DSN=https://" .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_SENTRY_DSN may not be set — Sentry error monitoring disabled (check .env.local)"
    fi
    if ! grep -q "SENTRY_AUTH_TOKEN=" .env.local 2>/dev/null; then
      echo "WARN: SENTRY_AUTH_TOKEN may not be set — Sentry source map upload will be skipped at build (check .env.local)"
    fi
    if ! grep -Eq "^(SENTRY_DSN|NEXT_PUBLIC_SENTRY_DSN)=https://" .env.local 2>/dev/null; then
      echo "WARN: SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) not set — curation job alerts will not reach Sentry (optional; set it on the curation worker service too)"
    fi
    if ! grep -q "SLACK_FORMORIA_WEBHOOK_URL=https://" .env.local 2>/dev/null; then
      echo "WARN: SLACK_FORMORIA_WEBHOOK_URL not set — curation provider-failure alerts will not reach Slack (optional)"
    fi
    if ! grep -q "NEXT_PUBLIC_POSTHOG_HOST=https://e.formoria.com" .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_POSTHOG_HOST must be https://e.formoria.com for production analytics capture"
    fi
    for var in NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN NEXT_PUBLIC_POSTHOG_UI_HOST POSTHOG_PROJECT_ID POSTHOG_PERSONAL_API_KEY POSTHOG_API_HOST POSTHOG_DASHBOARD_URL PERSONAL_OS_INTERNAL_TOKEN; do
      if ! grep -q "${var}=." .env.local 2>/dev/null; then
        echo "WARN: ${var} may not be set (required for the PostHog analytics hub)"
      fi
    done
    if ! grep -q "PRODUCTION_BASE_URL=https://" .env.local 2>/dev/null; then
      echo "WARN: PRODUCTION_BASE_URL not set — the production probe has no target (set as a GitHub repo variable in CI)"
    fi
    if ! grep -q "RAILWAY_LOGS_URL=." .env.local 2>/dev/null; then
      echo "WARN: RAILWAY_LOGS_URL not set (admin jobs page won't show logs link)"
    fi
    if ! grep -q "UPSTASH_REDIS_REST_URL=https://" .env.local 2>/dev/null; then
      echo "WARN: UPSTASH_REDIS_REST_URL not set — rate limiter will use in-memory fallback (not distributed)"
    fi
    __upstash_management_count=0
    for var in UPSTASH_API_EMAIL UPSTASH_API_KEY UPSTASH_REDIS_DATABASE_ID; do
      if grep -q "^${var}=." .env.local 2>/dev/null; then
        __upstash_management_count=$((__upstash_management_count + 1))
      fi
    done
    if [ "$__upstash_management_count" -eq 0 ]; then
      echo "WARN: Upstash Management API credentials are not configured — usage remains unknown"
    elif [ "$__upstash_management_count" -lt 3 ]; then
      echo "ERROR: UPSTASH_API_EMAIL, UPSTASH_API_KEY, and UPSTASH_REDIS_DATABASE_ID must be configured together"
      ERRORS=$((ERRORS + 1))
    else
      echo "OK: Upstash Management API credentials"
    fi
    unset __upstash_management_count
    if ! grep -q "CF_ORIGIN_SECRET=." .env.local; then
      echo "⚠ CF_ORIGIN_SECRET not set (optional — needed for Cloudflare origin protection)"
    fi
    # These two secrets belong to separate trust domains and MUST never share a
    # value. Rationale and the full model: docs/runbooks/cloudflare-edge.md.
    #
    # Normalise before comparing: ORIGIN_SECRET="abc" and CF_ORIGIN_SECRET=abc
    # are the SAME secret, and a trailing space or CRLF would likewise make two
    # identical values compare unequal. A security check that fails open is
    # worse than no check, so strip quoting and trailing whitespace first.
    __strip_env_value() {
      printf '%s' "$1" \
        | tr -d '\r' \
        | sed -e 's/[[:space:]]*$//' \
              -e 's/^"\(.*\)"$/\1/' \
              -e "s/^'\(.*\)'$/\1/" \
              -e 's/[[:space:]]*$//'
    }
    __origin_secret=$(__strip_env_value "$(grep -m1 '^ORIGIN_SECRET=' .env.local 2>/dev/null | cut -d= -f2-)")
    __cf_origin_secret=$(__strip_env_value "$(grep -m1 '^CF_ORIGIN_SECRET=' .env.local 2>/dev/null | cut -d= -f2-)")
    if [ -n "$__origin_secret" ] && [ "$__origin_secret" = "$__cf_origin_secret" ]; then
      echo "ERROR: ORIGIN_SECRET equals CF_ORIGIN_SECRET — these are two different trust domains and must never share a value"
      ERRORS=$((ERRORS + 1))
    fi
    unset __origin_secret __cf_origin_secret
    unset -f __strip_env_value
    if ! grep -q "CHALLENGE_SECRET=." .env.local; then
      echo "WARN: CHALLENGE_SECRET not set — progressive CAPTCHA challenge will fail in production"
    fi
    if grep -q "SERPER_API_KEY=." .env.local; then
      echo "OK: SERPER_API_KEY"
    else
      echo "WARN: SERPER_API_KEY not set (enrichment SERP/image search will fail)"
    fi
    if grep -q "OPENAI_API_KEY=." .env.local; then
      echo "OK: OPENAI_API_KEY"
    else
      echo "WARN: OPENAI_API_KEY not set (the entire enrichment pipeline will fail — descriptions, reputation, category classification, brand detection, and image classification)"
    fi
    if ! grep -q "INDEXNOW_KEY=." .env.local 2>/dev/null; then
      echo "WARN: INDEXNOW_KEY not set (optional — needed for Bing IndexNow submission)"
    fi
    # NOTE: the scheduled HTTP jobs authenticate with ORIGIN_SECRET and are
    # configured entirely in the database, not here. Scheduling, host routing and
    # how to verify a job actually ran: docs/runbooks/cloudflare-edge.md.
    if grep -q '^FORMORIA_DEPLOYMENT_ENV=staging$' .env.local 2>/dev/null; then
      if ! grep -q '^NEXT_PUBLIC_DEPLOYMENT_ENV=staging$' .env.local; then
        echo "WARN: staging requires NEXT_PUBLIC_DEPLOYMENT_ENV=staging to disable browser side effects"
      fi
      if ! grep -q '^FORMORIA_RUNTIME_URL=https://staging.formoria.com/?$' .env.local; then
        echo "WARN: staging FORMORIA_RUNTIME_URL must be https://staging.formoria.com"
      fi
    fi
    # NOTE: MIT registry sync is scheduled via pg_cron (Sundays 2 AM UTC,
    # job name: sync-mit-registry-weekly). Auth uses ORIGIN_SECRET (app.origin_secret).
    # See supabase/migrations/20260702130000_schedule_mit_registry_sync.sql
  fi
}

# ── brand_ai_results phase CHECK constraint ──────────────────────────────────
# insertAiCallResult swallows insert errors by design (an audit failure must never
# fail the enrichment call it records), so a phase CHECK that is behind the code
# silently drops EVERY audit and cost row. Railway auto-deploys on push to main
# but Supabase migrations are applied by hand, which makes "code ahead of schema"
# the normal failure mode rather than an edge case.
PHASE_CHECK_MIGRATION="supabase/migrations/20260803033000_widen_ai_results_phase_check.sql"
PHASE_CHECK_REMEDIATION="apply ${PHASE_CHECK_MIGRATION} with pnpm db:migrate — otherwise ALL audit and cost rows are dropped"

db_url() {
  local var
  for var in SUPABASE_DB_URL DATABASE_URL HEALTH_AGENT_READ_DATABASE_URL; do
    if [ -n "${!var:-}" ]; then
      echo "${!var}"
      return 0
    fi
    if [ -f ".env.local" ]; then
      local value
      value=$(grep -E "^${var}=.+" .env.local 2>/dev/null | head -n1 | cut -d= -f2- | tr -d "\"'")
      if [ -n "$value" ]; then
        echo "$value"
        return 0
      fi
    fi
  done
  return 1
}

check_ai_results_phase() {
  local url
  if url=$(db_url) && command -v supabase &> /dev/null; then
    local ledger
    ledger=$(supabase migration list --db-url "$url" 2>/dev/null || true)
    if [ -z "$ledger" ]; then
      echo "WARN: could not read the explicit migration target — verify by hand that the live brand_ai_results phase CHECK accepts 'facts' and 'reputation' (${PHASE_CHECK_REMEDIATION})"
      return
    fi

    if printf '%s\n' "$ledger" | grep -Eq '^[[:space:]]*\{'; then
      local json_status
      json_status=$(printf '%s\n' "$ledger" | node -e '
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => {
          try {
            const payload = JSON.parse(input);
            const migration = Array.isArray(payload.migrations)
              ? payload.migrations.find((row) => row?.local === "20260803033000")
              : null;
            process.stdout.write(
              typeof migration?.remote === "string" && migration.remote.trim()
                ? "found"
                : "missing",
            );
          } catch {
            process.stdout.write("invalid");
          }
        });
      ' 2>/dev/null || true)
      if [ "$json_status" = "found" ]; then
        echo "OK: brand_ai_results phase CHECK migration applied on the explicit target"
      else
        echo "ERROR: brand_ai_results phase CHECK migration is not applied on the explicit target. ${PHASE_CHECK_REMEDIATION}"
        ERRORS=$((ERRORS + 1))
      fi
      return
    fi

    local row
    row=$(printf '%s\n' "$ledger" | grep "20260803033000" || true)
    if [ -n "$row" ] && echo "$row" | awk -F'|' '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); exit ($2 == "" ? 1 : 0) }'; then
      echo "OK: brand_ai_results phase CHECK migration applied on the explicit target"
    else
      echo "ERROR: brand_ai_results phase CHECK migration is not applied on the explicit target. ${PHASE_CHECK_REMEDIATION}"
      ERRORS=$((ERRORS + 1))
    fi
    return
  fi

  if url=$(db_url) && command -v psql &> /dev/null; then
    local def
    def=$(psql "$url" -tAc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'brand_ai_results_phase_check'" 2>/dev/null || true)
    if [ -z "$def" ]; then
      echo "ERROR: brand_ai_results_phase_check not found on the live database. ${PHASE_CHECK_REMEDIATION}"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if [[ "$def" != *"'facts'"* || "$def" != *"'reputation'"* ]]; then
      echo "ERROR: brand_ai_results phase CHECK rejects 'facts'/'reputation'. ${PHASE_CHECK_REMEDIATION}"
      ERRORS=$((ERRORS + 1))
    else
      echo "OK: brand_ai_results phase CHECK accepts facts + reputation"
    fi
    return
  fi

  echo "WARN: no explicit database connection available — cannot verify the brand_ai_results phase CHECK (${PHASE_CHECK_REMEDIATION})"
}

# ── e2e env vars (opt-in with --e2e) ─────────────────────────────────────────
check_e2e() {
  if [[ "$*" == *"--e2e"* ]]; then
    echo "Checking e2e env vars..."
    for var in E2E_ADMIN_EMAIL E2E_ADMIN_PASSWORD E2E_USER_EMAIL E2E_USER_PASSWORD E2E_BRAND_SLUG E2E_CATEGORY_SLUG; do
      if [ -z "${!var}" ]; then
        echo "  MISSING: $var"
        ERRORS=$((ERRORS + 1))
      else
        echo "  OK: $var"
      fi
    done
  fi
}

# ── GitHub health agent (opt-in) ─────────────────────────────────────────────
has_env_value() {
  local var="$1"

  if [ -n "${!var:-}" ]; then
    return 0
  fi

  grep -Eq "^${var}=.+" .env.local 2>/dev/null
}

check_health_vars() {
  local mode=""
  local arg

  for arg in "$@"; do
    case "$arg" in
      --health-preflight)
        mode="preflight"
        ;;
      --health-live|--health-autofix)
        mode="live"
        ;;
    esac
  done

  if [ -z "$mode" ]; then
    return
  fi

  echo "Checking health agent ${mode} configuration..."

  local read_only_vars=(
    FORMORIA_RAILWAY_URL
    ORIGIN_SECRET
    SLACK_HEALTH_WEBHOOK_URL
    SENTRY_BASE_URL
    SENTRY_ORGANIZATION
    SENTRY_PROJECT
    SENTRY_READ_TOKEN
    HEALTH_AGENT_READ_DATABASE_URL
    HEALTH_AGENT_READ_DATABASE_PASSWORD
    HEALTH_AGENT_READER_TOKEN
    CLAUDE_CODE_OAUTH_TOKEN
  )
  read_only_vars+=(
    AGENT_HUB_TURSO_DATABASE_URL
    AGENT_HUB_TURSO_AUTH_TOKEN
  )
  local live_vars=(
    LINEAR_OAUTH_CLIENT_ID
    LINEAR_OAUTH_CLIENT_SECRET
    LINEAR_OAUTH_ACCESS_TOKEN
    LINEAR_TEAM_ID
    LINEAR_PROJECT_ID
    LINEAR_ASSIGNEE_ID
    HEALTH_AGENT_WRITE_DATABASE_URL
    HEALTH_AGENT_WRITE_DATABASE_PASSWORD
    HEALTH_AGENT_WRITER_TOKEN
    HEALTH_AGENT_GITHUB_APP_ID
    HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY
    HEALTH_AGENT_GITHUB_APP_INSTALLATION_ID
  )
  local var

  for var in "${read_only_vars[@]}"; do
    if has_env_value "$var"; then
      echo "  OK: $var"
    else
      echo "  MISSING: $var"
      ERRORS=$((ERRORS + 1))
    fi
  done

  if [ "$mode" = "live" ]; then
    for var in "${live_vars[@]}"; do
      if has_env_value "$var"; then
        echo "  OK: $var"
      else
        echo "  MISSING: $var"
        ERRORS=$((ERRORS + 1))
      fi
    done
  fi
}

# ── Run checks ───────────────────────────────────────────────────────────────
check_node
check_pnpm
check_deps
check_env
check_ai_results_phase
check_e2e "$@"
check_health_vars "$@"

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "All checks passed. Ready to dev!"
else
  echo "ERROR: $ERRORS issue(s) found. Fix them and re-run: make doctor"
  exit 1
fi
