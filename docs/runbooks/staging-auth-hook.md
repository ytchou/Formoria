# Staging Auth capture runbook

Apply the migration through the guarded staging migration command, then enable
`public.staging_capture_auth_email(jsonb)` as the staging Supabase Auth Send
Email Hook. Configure no production hook and no SMTP/external provider for
this flow.

The hook accepts only recipients beginning `e2e-signup-` and stores the action,
recipient, token hash, redirect target, and timestamp. `supabase_auth_admin`
has insert/execute only; the staging service role has test select/delete access;
anonymous and authenticated clients have no access. Verify RLS and grants
before the first suite run.

The function returns an empty JSON object on every accepted invocation, which
matches the current Supabase Send Email Hook contract. Do not invent a custom
success payload: Supabase does not require one, and relying on undocumented
response fields can break when the hook gateway tightens validation.

## Safe hosted configuration changes

- **Symptom:** A hosted config push can replace staging URLs, provider settings,
  or API schemas with local-development defaults.
- **Cause:** `supabase config push` applies the entire local `config.toml`
  immediately; it is not a dry-run command and does not prompt for approval.
- **Prevention:** Never push the repository's local config directly to a hosted
  project. Use a staging-specific configuration whose complete diff has been
  reviewed, then run the same comparison again and require every service to be
  `up_to_date`.
- **How to apply:** Preserve the existing hosted settings, change only email
  signup/confirmation and `auth.hook.send_email`, and keep the hook URI exactly
  `pg-functions://postgres/public/staging_capture_auth_email`.
