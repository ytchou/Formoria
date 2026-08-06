# DEV-1371 — Taiwan Creative Expo floor map execution plan

Date: 2026-08-06
Status: Approved; implementation held for stacked integration

## Scope

Implement the approved event-specific floor-map design without changing the
event route, services, database, analytics, or current event-page behavior.
DEV-1370 remains the owner of canonical event placement data. DEV-1372 will join
those placements to this controlled component and own real-page Playwright tests.

## Work items

1. Download and inspect the official PDF, render page 2, crop the central map
   panel, and commit a lossless 3200 × 2450 WebP under `public/images/events/`.
   Record the source URL, retrieval date, and inspected SHA-256 in the design and
   static config.
2. Add static geometry/configuration for K1/K2/K3/S, official localized names,
   focus bounds, the booth-prefix resolver, and selected/highlighted state
   precedence. Keep non-core areas visible but non-interactive and do not model
   booth coordinates.
3. Add the single client component in `src/components/events/`. Reuse existing
   Dialog, Button, Badge, typography, Next Image, and Lucide primitives. Render
   the map and SVG in one responsive aspect-ratio box; expose controlled props,
   48 px controls, counts, legend, reset, attribution, official links, fallbacks,
   full-screen mobile zoom/pan, focus restoration, and reduced-motion recentering.
4. Use a temporary local visual preview for raster/overlay calibration at desktop
   and 390 px widths, inspect representative labels, and remove the preview before
   handoff. Do not create a production route or a Knip suppression.

## Verification

Run one command at a time:

- `pnpm exec vitest run src/components/events/taiwan-creative-expo-floor-map-config.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm knip` (record the expected standalone-component unused-export blocker;
  do not suppress it)

The focused tests must prove the four zones are present, all polygons/focus
bounds remain inside `0 0 3200 2450`, booth prefixes resolve only to K1/K2/K3/S,
selected state wins over highlighted state, and the committed asset is WebP,
3200 × 2450, within the 2.5 MB budget, and aspect-ratio aligned with the config.

The temporary preview confirmed aspect-ratio calibration and representative booth
labels at desktop and 390 px widths. A separate temporary Vite harness mounted
the component and ran a Playwright Chromium pass at 1100 × 900 and 390 × 844:
pointer K2, keyboard K1 and polygon reset, zero-count selection, selected-over-
highlighted precedence, controlled external rerender, dialog open/close/Escape
and focus restoration, selected-zone auto-focus, fit/2×/4×/8× zoom, native
two-axis pan, image failure, reduced-motion recentering, no-JavaScript fallback
markup, and mobile tap all passed with zero page errors. The harness and server
were removed before handoff. Real-page behavior and Playwright coverage remain
owned by DEV-1372, which will exercise this component through the event route.

## Merge gate

Commit coherent implementation waves on `feat/dev-1371-expo-floor-map`; do not
push, merge, or mark merge-ready. Keep the branch held until DEV-1370 completes
and the stacked DEV-1372 integration PR consumes this component. If the approved
republishing authorization is invalidated, stop and remove the derivative rather
than substituting an unapproved asset.
