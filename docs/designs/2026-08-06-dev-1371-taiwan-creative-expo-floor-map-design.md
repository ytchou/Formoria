# DEV-1371 — Taiwan Creative Expo floor map

Date: 2026-08-06
Status: Approved for the held DEV-1371 branch; do not merge independently

## Goal

Give the event-page integration a responsive, keyboard-accessible map for the four
canonical creative-expo zones that DEV-1370 supplies to DEV-1372. A visitor can
select K1, K2, K3, or S, see the controlled selected/highlighted state, and open a
full-screen mobile viewer without adding a map SDK, route, database field, or
booth-coordinate model.

## Source and derivative

The raster is a derivative of page 2 of the official 2026 Taiwan Creative Expo
folded map:

- Source URL: `https://creativexpo.tw/uploads/download/file/9/2026%E8%87%BA%E7%81%A3%E6%96%87%E5%8D%9A%E6%9C%83%E6%91%BA%E9%A0%81DM(2).pdf`
- Retrieved: 2026-08-06
- Inspected source SHA-256: `ccd1cd250a7b3593c730d5d70e3c137eec684d282ab1c0b0b9579c96952d06bb`
- Published derivative: `public/images/events/taiwan-creative-expo-2026-floor-map.webp`
- Derivative dimensions: 3200 × 2450, sRGB RGB WebP, lossless, 779 KB at inspection

The crop is the centered page-2 map panel with the surrounding service and
entrance labels retained. The image and SVG share the same `0 0 3200 2450`
view box and use `preserveAspectRatio="none"` inside an identical aspect-ratio
container, so the overlay does not letterbox or shift at mobile widths.

Republishing authorization is an approved ticket assumption. If that
authorization is withdrawn, the derivative must be removed and this design is
blocked rather than replaced with an unapproved map source.

## Public component contract

`TaiwanCreativeExpoFloorMap` is the only client component introduced by this
ticket. Its props are controlled by the consuming event integration:

```ts
type ExpoZoneCode = 'K1' | 'K2' | 'K3' | 'S'

type TaiwanCreativeExpoFloorMapProps = {
  selectedZone: ExpoZoneCode | null
  highlightedZones?: readonly ExpoZoneCode[]
  zoneCounts: Readonly<Record<ExpoZoneCode, number>>
  onZoneSelect: (zone: ExpoZoneCode) => void
  onReset: () => void
}
```

The component never mirrors selected filtering state. Activating the selected
control or selected polygon calls `onReset`; zero-count zones remain selectable.
DEV-1370 owns canonical event placement and DEV-1372 owns brand/booth join and
real-page Playwright coverage.

## Static geometry and state

`src/components/events/taiwan-creative-expo-floor-map-config.ts` owns:

- the image dimensions, aspect ratio, source metadata, and 2.5 MB size budget;
- calibrated K1/K2/K3/S polygons and focus bounds in image coordinates;
- official localized names (the localized key is display copy, never a join key);
- the `K1`, `K2`, `K3`, and `S` booth-prefix resolver; all other map prefixes
  resolve to `null`;
- deterministic state resolution: selected wins over highlighted, and other
  zones become secondary only while a selection exists.

K4, J1, J2, J3, IP-STAR, stage, rest/service areas, badge counters, buyers'
lounge, first aid, and entrances stay visible in the source image and are
explicitly non-interactive. Booth labels remain part of the raster; no booth
markers or coordinates are created.

## Interaction and accessibility

- Four always-visible, 48 px zone controls expose code, English name, and count;
  controls use `aria-pressed` and keyboard activation.
- SVG polygons are focusable buttons with matching keyboard and pointer behavior.
- A legend explains selected, highlighted, secondary, and non-interactive areas;
  reset and bilingual source attribution remain visible next to official links.
- The inline image uses Next `Image` and an image-error fallback that links to the
  official PDF. A `<noscript>` fallback provides the same official link without
  JavaScript.
- The mobile viewer is a controlled `Dialog`: it is full-screen on small screens,
  restores the opening focus target, closes through Escape/close, and supports fit,
  2×, 4×, and 8× zoom. Its scroll container provides native two-axis panning;
  the selected zone is centered on open and after zoom changes. Re-centering uses
  instant scrolling when `prefers-reduced-motion` is enabled.

## Verification and merge gate

Pure Vitest tests cover every zone, polygon/focus bounds, booth-prefix routing,
selected/highlighted precedence, and the committed WebP dimensions/size/aspect
ratio. A temporary local raster/SVG preview was used to inspect the map at desktop
and 390 px widths, and a separate temporary Vite harness mounted the React
component for a Playwright Chromium interaction pass. At 1100 × 900, the pass
confirmed raster loading (3200 × 2450), four controls including zero-count K1,
pointer K2 selection, keyboard K1 and polygon reset, selected-over-highlighted
precedence, controlled external rerender, dialog open/close/Escape focus
restoration, selected-zone auto-focus (K3 at 2× reached scroll 988 × 622), fit/
2×/4×/8× zoom, two-axis pan (7904 × 6052 content in a 988 × 544 viewport),
reduced-motion `auto` recentering, no-JavaScript fallback markup, and image-error
fallback. At 390 × 844, a touch tap selected K3. The run had zero page errors.
The harness and server were removed before handoff; real-page Playwright coverage
remains owned by DEV-1372.

Run focused Vitest, TypeScript checking, and lint. Run Knip without a suppression;
the new standalone component is expected to be the one merge blocker until
DEV-1372 consumes it. Do not add a production route, analytics, service, DB
change, or temporary route to make Knip pass. Keep this branch held until DEV-1370
finishes and DEV-1372 consumes the component in the stacked integration PR.
