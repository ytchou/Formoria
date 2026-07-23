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
    if ! grep -q "NEXT_PUBLIC_POSTHOG_HOST=https://e.formoria.com" .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_POSTHOG_HOST must be https://e.formoria.com for production analytics capture"
    fi
    for var in NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN NEXT_PUBLIC_POSTHOG_UI_HOST POSTHOG_PROJECT_ID POSTHOG_PERSONAL_API_KEY POSTHOG_API_HOST POSTHOG_DASHBOARD_URL PERSONAL_OS_INTERNAL_TOKEN; do
      if ! grep -q "${var}=." .env.local 2>/dev/null; then
        echo "WARN: ${var} may not be set (required for the PostHog analytics hub)"
      fi
    done
    if ! grep -q "RAILWAY_LOGS_URL=." .env.local 2>/dev/null; then
      echo "WARN: RAILWAY_LOGS_URL not set (admin jobs page won't show logs link)"
    fi
    if ! grep -q "UPSTASH_REDIS_REST_URL=https://" .env.local 2>/dev/null; then
      echo "WARN: UPSTASH_REDIS_REST_URL not set — rate limiter will use in-memory fallback (not distributed)"
    fi
    if ! grep -q "CF_ORIGIN_SECRET=." .env.local; then
      echo "⚠ CF_ORIGIN_SECRET not set (optional — needed for Cloudflare origin protection)"
    fi
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
      echo "WARN: OPENAI_API_KEY not set (image classification will fail)"
    fi
    if ! grep -q "INDEXNOW_KEY=." .env.local 2>/dev/null; then
      echo "WARN: INDEXNOW_KEY not set (optional — needed for Bing IndexNow submission)"
    fi
    if ! grep -q "NEXT_PUBLIC_TINA_CLIENT_ID=." .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_TINA_CLIENT_ID not set (TinaCMS admin will not connect to Tina Cloud)"
    fi
    if ! grep -q "TINA_TOKEN=." .env.local 2>/dev/null; then
      echo "WARN: TINA_TOKEN not set (TinaCMS admin will not connect to Tina Cloud)"
    fi
    # NOTE: MIT registry sync is scheduled via pg_cron (Sundays 2 AM UTC,
    # job name: sync-mit-registry-weekly). Auth uses ORIGIN_SECRET (app.origin_secret).
    # See supabase/migrations/20260702130000_schedule_mit_registry_sync.sql
  fi
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
    AGENT_HUB_INGEST_URL
    AGENT_HUB_INGEST_TOKEN
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
  local live_vars=(
    SENTRY_RESOLVER_TOKEN
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
check_e2e "$@"
check_health_vars "$@"

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "All checks passed. Ready to dev!"
else
  echo "ERROR: $ERRORS issue(s) found. Fix them and re-run: make doctor"
  exit 1
fi
