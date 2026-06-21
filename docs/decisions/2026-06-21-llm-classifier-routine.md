# ADR: LLM-as-Classifier via Claude Code Routine

Date: 2026-06-21

## Decision
Use a Claude Code Routine (LLM reasoning + Sentry Seer AI) for error severity classification instead of hardcoded TypeScript rules.

## Context
Error triage requires interpreting Seer's natural-language root cause analysis and making nuanced severity judgments (user-facing impact, fix complexity, escalation trend). This is fundamentally an LLM reasoning task.

## Alternatives Considered
- **Hardcoded TypeScript rules**: Rejected — Seer output is unstructured natural language; regex/keyword rules would be brittle and miss nuance.
- **Traditional API route with LLM API call**: Rejected — would need to re-implement MCP tool orchestration that Claude Code Routines provide natively.

## Rationale
The LLM IS the classification engine. The routine prompt is the "source code." Phase progression (adding Linear/GitHub actions) is prompt updates, not new infrastructure.

## Consequences
- Advantage: Nuanced classification that improves with prompt tuning
- Advantage: Zero traditional code for classification logic
- Disadvantage: Classification quality depends on prompt engineering; requires Phase 1 validation period
