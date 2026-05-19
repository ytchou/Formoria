# ADR: Auto-trigger claim email on submission approval

Date: 2026-05-19

## Decision
When an admin approves a brand submission where `is_brand_owner=true`, the system automatically sends a claim email to the submitter — no separate manual action required.

## Context
Brand owners who submit their listing need a way to claim ownership after approval. The claim email contains a signed link that associates the owner with their brand. The trigger mechanism determines admin workflow complexity.

## Alternatives Considered
- **Manual admin action**: Admin approves, then separately clicks "Invite Owner." Rejected: adds unnecessary friction for admins with no clear benefit — if the submission is approved and the owner flag is set, the invite should always follow.
- **Batch daily digest**: Approved owners receive a daily digest email. Rejected: adds latency to the owner experience (up to 24hr delay) and the daily processing pipeline (DEV-651) is for submission processing, not post-approval notifications.

## Rationale
Auto-triggering is the simplest path and matches the user expectation: submit → approved → claim. Every approved brand-owner submission should result in a claim email. There's no scenario where an admin would approve an owner submission but not want to send the invite.

## Consequences
- Advantage: Zero admin friction, immediate owner notification
- Disadvantage: No admin override to delay the invite (acceptable for v1 volume)
