# ADR: Immediate Upload on File Select

Date: 2026-05-18

## Decision
Upload images to Supabase Storage immediately when the user selects a file, not on final form submission.

## Context
The submission form includes a logo upload (Step 1) and product photos (Step 2, up to 6 files). Each file is resized client-side to max 1200px WebP before upload.

## Alternatives Considered
- **Upload all on final submit**: Hold files in browser memory until Step 4 submit, then batch upload. Rejected: creates a long wait at submit time (especially with 6 photos), risk of browser timeout or memory pressure with multiple large images, and poor UX with no progress feedback during the critical submit action.

## Rationale
Immediate upload provides instant feedback (progress bar + preview from the returned public URL), distributes upload time across the form flow, and keeps the final submit fast (just saving URLs). The trade-off is orphaned files when users abandon the form, which is acceptable for v1 -- a future cleanup cron can handle this.

## Consequences
- Advantage: Better UX -- each upload shows progress and preview immediately
- Advantage: Final submit is fast -- just a DB write with URLs
- Disadvantage: Orphaned files in Supabase Storage when users abandon mid-form
- Mitigation: Future cron job to clean unreferenced files after 24h
