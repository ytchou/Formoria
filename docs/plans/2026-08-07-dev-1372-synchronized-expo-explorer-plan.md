# DEV-1372 — Synchronized Expo Map and Brand Explorer Plan

## Scope

Build the Creative Expo map/list explorer on top of DEV-1370 and DEV-1371, preserving the unrelated `docs/e2e-journeys.md` edit. Do not add dependencies, routes, migrations, analytics, booth coordinates, or Knip suppressions.

## Wave 1 — Service contract and pure state logic

1. Add `LinkedEventExhibitorEntry` refinement and a pure selector over `getEventExhibitorEntries` for linked K1/K2/K3/S brands.
2. Make canonical zone authoritative and verify zone/booth agreement with DEV-1371's resolver.
3. Add pure filtering, search, contextual counts/highlights, sorting, URL allowlisting, and reset behavior.
4. Add focused pure tests that demonstrate FAIL then PASS for linked refinement, projection, consistency, AND filtering, expanded search fields, highlights/counts, URL allowlisting, and reset.

Verification: focused Vitest for the touched service/state modules.

## Wave 2 — Controlled brand view and synchronized explorer

1. Extract a controlled internal brand-result view from `EventBrandGrid` without changing other event pages.
2. Extend `MasonryGrid` with an opt-in compact semantic layout while keeping its default unchanged.
3. Add `TaiwanCreativeExpoExplorer` as the single client state owner and reuse DEV-1371's controlled map API.
4. Keep both mobile panels mounted, use container-responsive zone controls, localize visible/accessibility copy, and preserve server-rendered links.

Verification: focused existing service/grid tests, TypeScript, lint, and Prettier check.

## Wave 3 — Creative Expo page integration and degraded behavior

1. Reframe only the Creative Expo detail page with event disclosure, explorer, existing editorial content, logistics, reservation/directions, sources, attribution, and verification date.
2. Preserve existing event pages, ISR, SEO, and JSON-LD behavior.
3. Treat roster failure as degraded uncached rendering while leaving map/editorial/logistics/source content available.
4. Confirm map failure leaves the list usable and empty roster state is distinct from read failure.

Verification: `make doctor`, canonical migration/count checks, focused Vitest, configured real-DB integration test, TypeScript, Prettier, lint, Knip, production build, and scoped Playwright after e2e authoring.

## Delivery

- Commit implementation on the combined DEV-1371/DEV-1372 branch.
- Defer Playwright authoring to the post-implementation e2e gate required by the execution workflow.
- Run review-and-fix and create-pr only after the executing-plans hard gate is explicitly released.
