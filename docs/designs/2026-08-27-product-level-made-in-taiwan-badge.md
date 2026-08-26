# Product-level Made in Taiwan badge

## Goal

Show `台灣製造` / `Made in Taiwan` only on a curated product whose own official
evidence qualifies it. A brand never inherits the claim, and one qualifying
product never qualifies a sibling.

## Qualification flow

The existing products enrichment phase receives 6–25 catalog candidates. It
renders each candidate's official product page and extracts at most four targeted
320-character excerpts from the main product text. Brand story, design,
supervision, and shipping statements are excluded.

All gate-passing candidates receive an editorial evaluation. The five highest
editorial scores are chosen before origin is considered; origin can only break a
tie inside that set. The same LLM response evaluates excerpt IDs and returns full
proposals for those finalists, so qualification adds no model call.

A finalist qualifies by one of two methods:

1. An exact normalized brand, product, and model match to an active registry row
   whose expiry is valid and whose weekly mirror is no more than 192 hours old.
2. Both the deterministic scanner and LLM confirm Taiwan manufacture and complete
   Taiwan origin for every primary material.

Missing, ambiguous, partial, stale, or disagreeing evidence fails closed. Every
passing candidate stores the deterministic, LLM, and registry decisions plus the
final method. Gated candidates retain null assessments. If audit persistence
fails, the proposal may still publish but all origin qualification is cleared.

## Materialization and invalidation

Candidate IDs are allocated before logging, and a successful finalist carries its
audit ID into the proposal. Approval copies the two confirmation facts and
nullable registry/audit references onto new products. Existing products are
refreshed only when they are generated and match the proposal. A reviewer edit to
the assessed official URL clears origin state.

The public `mitQualified` value is derived at read time from either a fresh active
registry relation or both stored confirmation facts. A withdrawn or expired
registry row therefore removes the badge without rewriting the product.

## Presentation

Every `SelectedProductTile` mode renders the existing verified badge with
`ShieldCheck` as a top-left image overlay. Chinese surfaces use `台灣製造`; English
surfaces use `Made in Taiwan`. Brand cards and headers show no corresponding
badge, and there is no manual origin editor.

## Pre-mortem

The design fails entirely if rendered excerpts are not tied to the official
product page being assessed. The stored excerpt IDs, assessed URL, and URL-edit
invalidation make that linkage explicit. The most dangerous silent failure is an
audit write error leaving a visible claim, so logging failure forcibly suppresses
qualification while leaving ordinary publication independent.
