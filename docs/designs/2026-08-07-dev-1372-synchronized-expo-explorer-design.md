# DEV-1372 — Synchronized Expo Map and Brand Explorer

## Decision

The Taiwan Creative Expo detail page will use one client-side explorer that owns map and brand-list state while consuming DEV-1370's canonical `event_exhibitors` roster. This is event-specific, so no ADR is required.

## Data contract

- Refine `EventExhibitorEntry` to `LinkedEventExhibitorEntry` only when a public brand is linked.
- Treat canonical `entry.zone` as placement truth; DEV-1371's booth resolver verifies consistency only.
- Include linked K1, K2, K3, and S entries. Exclude non-interactive J2 entries.
- A `null` roster means the canonical read failed; `[]` means the read succeeded with no linked core-zone brands.

## Interaction model

- `TaiwanCreativeExpoExplorer` owns zone, category, query, sort, expansion, and mobile panel state.
- Category, query, and zone filters compose with AND semantics.
- Zone counts are computed after category/query filtering but before applying the selected zone.
- With no selected zone, every zone represented by the filtered results is highlighted; selection overrides highlights.
- Only allowlisted `zone` and `category` values are synchronized through `history.replaceState`. Other state remains transient.
- Global clear resets zone, category, and query. The map reset continues to clear only zone selection.

## Rendering and resilience

- Desktop uses a sticky map/results split from `lg`; mobile switches between map and list while both panels remain mounted.
- Existing brand-card rendering is reused through a controlled internal view, and `MasonryGrid` gains an opt-in compact semantic layout without changing its default behavior.
- All brand links remain in server HTML.
- Map failure must not block results. Roster failure uses the existing degraded-render path and must not cache the degraded response; editorial and logistics content remains visible.

## Page framing

Only the Creative Expo page changes: event introduction and Formoria-subset disclosure, explorer controls, existing editorial selections, and event logistics/sources. Other event pages retain `EventBrandGrid`.

## Failure gates

The critical assumption is availability of DEV-1370's canonical roster and links. The main silent-risk check is contextual count derivation: the selected zone count must match visible results while other zone counts remain category/search-compatible.
