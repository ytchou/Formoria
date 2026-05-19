# ADR: Two-tier keyword moderation for brand owner edits

Date: 2026-05-19

## Decision
Brand owner edits pass through a two-tier keyword/regex moderation system: Tier 1 (block) rejects edits containing hard-banned content; Tier 2 (flag) saves the edit but creates a moderation flag for admin review.

## Context
Brand owners get full edit rights over their listing after claiming. Unrestricted editing poses risk of spam, offensive content, or legal liability. Moderation must balance owner freedom with content safety.

## Alternatives Considered
- **LLM content check (Claude API)**: More nuanced detection, fewer false positives, can explain flags. Rejected for v1: ongoing API cost with no revenue to offset. Created as a future ticket for when cost/benefit makes sense.
- **Manual approval queue for all edits**: Every edit goes through admin review before publishing. Rejected: high admin burden, poor owner experience, doesn't scale.
- **No moderation (defer)**: Ship claim flow without moderation, add later. Rejected: unacceptable risk window for legal/brand safety issues.

## Rationale
Keyword/regex is zero marginal cost, fast (synchronous check), and sufficient for v1 volume. Two tiers provide proportional response: obvious violations are blocked immediately, while borderline content gets saved (good owner experience) but flagged for review (admin safety net). The moderation service is a clean abstraction that can be swapped for LLM-based checking later.

## Consequences
- Advantage: Zero API cost, instant response, clear upgrade path to LLM
- Disadvantage: Higher false positive/negative rate than LLM, requires manual blocklist maintenance
