# Staging seed runbook

Run from the linked worktree with staging-only values:

```sh
FORMORIA_DEPLOYMENT_ENV=staging \
STAGING_BASE_URL=https://staging.formoria.com \
SUPABASE_PROJECT_REF="$SUPABASE_PROJECT_REF" \
SUPABASE_DB_URL="$SUPABASE_DB_URL" \
NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
ADMIN_EMAILS="$ADMIN_EMAILS" \
E2E_USER_EMAIL="$E2E_USER_EMAIL" E2E_USER_PASSWORD="$E2E_USER_PASSWORD" \
E2E_ADMIN_EMAIL="$E2E_ADMIN_EMAIL" E2E_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" \
pnpm db:seed:staging
```

Run it twice. The fixture and both durable accounts must remain one row/account
each. The command rejects production or cross-wired URLs before the first SQL or Auth
mutation. The staging key guard accepts only JWT keys whose decoded `ref` is
`SUPABASE_PROJECT_REF` and whose roles are `anon` and `service_role`;
publishable/secret key strings fail closed because they do not expose project
identity offline. Never source a production database URL or copy users.
