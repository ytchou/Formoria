# E2E Plan — Brand Location Channels

## Journey 1 — Actual owner confirms and persists an addressed physical location

- **Actor:** Authenticated user who is the actual owner of an approved brand.
- **Goal:** Add an addressed physical location in the dashboard editor, explicitly confirm it as the owner, and see both the address and confirmation remain after saving and returning.
- **Preconditions:** An isolated authenticated owner fixture; a service-role-created `[E2E-TEST]` approved brand assigned to that owner; the brand is otherwise valid for dashboard editing.
- **Steps:**
  1. Open the owned brand in the dashboard editor and navigate to the locations section.
  2. Add a physical location with a recognizable name and full street address.
  3. Mark the location as confirmed by the owner.
  4. Save the draft, leave the editor, then reopen the same brand and locations section.
  5. Publish/save the completed edit as required by the flow, reload, and inspect the location again.
- **Expected:** The dashboard exposes owner confirmation only to the actual owner; the addressed location can be confirmed; its name, full address, channel type, and confirmed state remain visible after draft save, navigation away, reopen, final save/publish, and reload. An address validation error is visible and confirmation cannot be persisted if the address is removed.
- **Risk if broken:** Owner-confirmed trust signals may be lost, or an incomplete/stale location may be represented as owner-confirmed.
- **DB/auth state:** Use the authenticated owner storage state plus service-role `[E2E-TEST]` self-seeding. Clean up the brand and its location rows explicitly (with global teardown as a safety net). Do not depend on ambient brands.
- **Target project:** Deep (Chromium-only).
- **Destination spec path:** `e2e/tests/dashboard-brand-owned-edit.spec.ts`.

## Journey 2 — Visitor explores confirmed, unconfirmed, and chain location groups safely

- **Actor:** Anonymous public visitor using desktop and mobile viewports, mouse/touch, and keyboard.
- **Goal:** Understand where a mixed brand can be found while clearly distinguishing confirmed physical locations, unconfirmed leads, and retail chains without leaking unsafe or unverified details.
- **Preconditions:** A service-role-created, approved `[E2E-TEST]` public brand containing multiple confirmed physical locations across filterable areas, at least one unconfirmed lead with a sensitive address stored in the database, and at least one retail-chain channel with a safe HTTPS retailer URL. Wait for the public page to observe the seed through ISR poll-reload.
- **Steps:**
  1. Open the public brand page anonymously and wait through ISR poll-reload until the seeded location content appears.
  2. Inspect the confirmed, unconfirmed, and retail-chain groups and their visible status/disclaimer text.
  3. Verify each group’s visible address and outbound actions, including confirmed map actions and the chain retailer link.
  4. Use every available location filter and clear/reset control; confirm the visible list and map results stay in sync.
  5. Operate filters and list/map controls using only the keyboard and verify focus and selected state are observable.
  6. Switch to a mobile viewport and repeat the primary filtering and location-opening flow with touch-sized controls.
- **Expected:** The three groups are visually and semantically distinguishable. Confirmed physical locations show their intended public addresses, appear in the map/list results, and open the correct external map destination. Unconfirmed leads show only safe public identity/status information—the stored sensitive address, map marker, and map/address link never render. Retail chains show the intended safe retailer link without being presented as a confirmed street address or physical map marker. Filters deterministically narrow both the visible list and eligible markers and can be reset. All interactive controls are keyboard reachable, expose an observable focus/selected state, and have at least a 48×48 CSS-pixel hit target. The mobile layout remains usable without clipped content, horizontal page overflow, obscured controls, or inaccessible actions.
- **Risk if broken:** Sensitive lead addresses could leak; unsafe or misleading links/maps could send visitors to the wrong place; group semantics could imply false verification; filtering or inaccessible controls could make locations unusable on mobile or by keyboard users.
- **DB/auth state:** Anonymous browser context. Service-role `[E2E-TEST]` self-seed all brand, location, chain, and relationship rows, using uniquely recognizable values and explicit cleanup. Assert against the seeded records only.
- **Target project:** Deep (Chromium-only), with desktop and mobile viewport coverage in the same journey.
- **Destination spec path:** `e2e/tests/brand-detail.spec.ts`.

## Journey 3 — Littdlework name-only records render without a map

- **Actor:** Anonymous visitor.
- **Goal:** Read Littdlework’s legacy name-only location records without the page inventing map precision that the records do not contain.
- **Preconditions:** The canonical Littdlework test fixture is available at `/brands/littdlework` and includes location/channel records with names but no usable street address or coordinates.
- **Steps:**
  1. Open `/brands/littdlework` anonymously.
  2. Locate the public locations/channels section and inspect the name-only entries.
  3. Inspect the section for a map, markers, address text, and map/address actions.
- **Expected:** The known Littdlework names remain visible in their appropriate best-effort grouping, while no location map, marker, fabricated address, or map/address action is rendered for those name-only records.
- **Risk if broken:** Visitors could be shown false geographic precision or lose access to useful legacy channel names merely because precise location data is unavailable.
- **DB/auth state:** Anonymous browser context; read-only use of the canonical Littdlework test fixture, with no mutation or cleanup.
- **Target project:** Deep (Chromium-only).
- **Destination spec path:** `e2e/tests/brand-detail.spec.ts`.

## Deferred catalog update

The matching `docs/e2e-journeys.md` update is intentionally deferred because the dirty primary checkout must remain untouched. This linked-worktree task changes only this e2e plan file.
