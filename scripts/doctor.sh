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
    if ! grep -q "RESEND_API_KEY=" .env.local 2>/dev/null; then
      echo "WARN: RESEND_API_KEY may not be set (optional transactional owner emails will no-op)"
    fi
    if ! grep -q "NEXT_PUBLIC_SENTRY_DSN=https://" .env.local 2>/dev/null; then
      echo "WARN: NEXT_PUBLIC_SENTRY_DSN may not be set — Sentry error monitoring disabled (check .env.local)"
    fi
    if ! grep -q "SENTRY_AUTH_TOKEN=" .env.local 2>/dev/null; then
      echo "WARN: SENTRY_AUTH_TOKEN may not be set — Sentry source map upload will be skipped at build (check .env.local)"
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

# ── Run checks ───────────────────────────────────────────────────────────────
check_node
check_pnpm
check_deps
check_env
check_e2e "$@"

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "All checks passed. Ready to dev!"
else
  echo "ERROR: $ERRORS issue(s) found. Fix them and re-run: make doctor"
  exit 1
fi
