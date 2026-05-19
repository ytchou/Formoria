# ADR: Sign-up with claim token for brand ownership

Date: 2026-05-19

## Decision
Brand owners claim their listing by signing up via a link containing a signed JWT claim token. The token is passed through Supabase's `emailRedirectTo` to survive the confirmation flow, then validated in the auth callback to create the ownership record.

## Context
After admin approval, brand owners need to create an account and be linked to their brand. The mechanism must work within the existing email/password auth (no magic links in v1, per ADR 2026-05-18-email-password-auth).

## Alternatives Considered
- **Add magic link support**: One-click claim via Supabase magic link. Better UX but expands auth scope beyond the v1 email/password decision. Rejected: scope creep, can upgrade later.
- **Pre-create account + password reset**: System creates a Supabase account, sends a password reset link. Rejected: creates accounts before user consent, and password reset emails don't communicate the "claim" context well.
- **Supabase invite API with metadata**: Use `auth.admin.inviteUserByEmail()` with claim data in `user_metadata`. Rejected: less control over email branding/content, and metadata isn't cryptographically signed.

## Rationale
A signed JWT in the sign-up URL is stateless, secure, and works within existing auth. The token carries `brand_id` + `email` with a 7-day expiry. No new DB tables for tokens, no changes to the auth provider. The sign-up page detects the claim param and shows contextual messaging.

## Consequences
- Advantage: Stateless verification, no token cleanup, reuses existing auth flow
- Disadvantage: Owner must complete full sign-up (email + password + confirmation) — more friction than magic link, acceptable for v1
