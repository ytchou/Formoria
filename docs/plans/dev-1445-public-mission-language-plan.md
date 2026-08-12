# DEV-1445 — Public Mission and zh-TW Voice System

## Objective

Persist the founder-approved public mission and Taiwan-Mandarin language system
in Formoria's canonical Brand Mission & Voice Guide and in repository
documentation. This is a Strategy/M documentation change. It does not change
application code, routes, schemas, UI, translations, or Linear state.

## Protected approved language

The following statements are fixed. They must be copied exactly wherever the
guide presents the four-level hierarchy:

- **Mission (canonical zh-TW):** 「Formoria 把從靈感走到購買中間斷掉的路接回來，幫助人從自己想要的生活出發，找到適合的台灣產品、認識背後的品牌，也知道可以去哪裡購買。」
- **Mission (current English translation):** “Formoria reconnects the broken path from inspiration to purchase by helping people start with the life they want, find Taiwanese products that suit them, get to know the brands behind them, and know where to buy.”
- **Product promise:** 「從你的情境、用途或偏好開始，Formoria 挑出值得細看的產品、說清楚為什麼選它，再帶你前往品牌自己的官方通路。」
- **Present positioning:** 「Formoria 是台灣品牌探索與選物平台。目前從可搜尋的品牌收錄出發，整理品牌資料、產品特色與官方購買通路；由 Formoria 挑選的內容會另外標示。」
- **Vision:** 「打造一個台灣品牌線上選物空間，讓人可以慢慢逛、找到新的偏好，認識產品背後的品牌，再前往品牌官方或實體通路。」

Language governance is also fixed: **zh-TW is Formoria’s canonical public
language; English currently serves as a faithful translation; when they
diverge, resolve in favor of intended zh-TW meaning and Taiwanese POV.**

The product promise is an approved editorial standard, not a shipped capability
until the first complete `主題選物` exists.

## Scope

1. Create the approved design document at
   `docs/designs/2026-08-12-dev-1445-public-mission-language.md`.
2. Create this execution plan at the requested path.
3. Update the existing Notion page `3ba0d2d7-93cf-8150-9f2b-d4605d72b7cd`
   (Formoria Brand Mission & Voice Guide) in place with the four statements,
   public terminology, voice sequence, vocabulary rules, eight context pairs,
   inclusive-language review, and 12-point founder/AI checklist.
4. Preserve the trust boundary between `收錄品牌`、`Formoria 選物`、`品牌提供`
   and `贊助內容`.
5. Record current public-copy conflicts as DEV-1446 downstream work only.

## Terminology decisions

- `主題選物` is the public label for Discovery Trails. It is not an internal
  model rename, schema rename, or route/URL rename.
- `選物` is reserved for a deliberate Formoria editorial choice with an
  explainable context and rationale. Directory inclusion uses `收錄`.
- `收錄品牌` means a brand meets directory listing rules; it is not an
  endorsement.
- `Formoria 選物` means an editorially selected product or content item.
- `品牌提供` identifies facts, images, sources, or corrections supplied by a
  brand; participation does not guarantee coverage or editorial control.
- `贊助內容` identifies paid or commercial content and must be visibly distinct
  from organic selection, excluded from organic ranking/selection logic, and
  disclosed at the point of action.
- URL/route naming remains deferred. Five-reader validation of `主題選物` is a
  later route-implementation gate, not a DEV-1445 blocker.

## Execution waves

### Wave 1 — Repository artifacts

- Write the approved design standard with the fixed language, terminology
  boundaries, voice sequence, vocabulary, exactly eight context examples,
  inclusion rules, checklist, source-fidelity notes, red-team gates, and the
  DEV-1446 handoff.
- Keep the design and plan documentation-only; do not add an ADR because no
  technology architecture changes.

### Wave 2 — Canonical Notion guide

- Immediately before any Notion write, fetch the current page again.
- Produce a complete numbered zh-TW preview mapping each exact original passage
  to its approved replacement. Wait for founder/parent acknowledgement.
- After acknowledgement, apply only targeted `update_content` replacements to
  the mission sentence, hierarchy, trust distinction, voice sequence, words and
  labels, and open-work section. Preserve roadmap, child content, and unrelated
  strategy material.
- Re-fetch the page after the update and compare its required content with the
  design document.

### Wave 3 — Verification and handoff

- Confirm every required deliverable appears in the guide: all four hierarchy
  statements, the two naming decisions, four trust labels, vocabulary rules,
  exactly eight context pairs, inclusive-language review, and 12 checklist
  points.
- Review fidelity against the Product & Delivery, SEO & Content, and Editorial
  Governance & Brand Relations guides.
- Red-team for implied sales, stock, certification, guarantees, rankings,
  unsupported claims, and directory/editorial conflation.
- Check Taiwan Mandarin, full-width punctuation, genericity, protected facts,
  `git diff --check`, and owned-file scope.

## Downstream-only record

DEV-1445 must not edit `messages/zh-TW.json` or shipped public copy. Record these
conflicts for DEV-1446:

- `footer.tagline`: 「讓台灣品牌更容易被看見」.
- `landing`: current metadata, hero, and manifesto copy that overstates brand
  promotion or selection.
- `about.mission.statement`: 「讓台灣品牌更容易被看見、被選擇，也更容易成長。」
- `vision`: current copy that presents the future direct-order/select-shop model
  as current.

## Non-scope and assumptions

- No app code, route, URL, schema, UI, TypeScript type, or translation changes.
- No Linear status changes and no edits to other strategy pages.
- Founder approval date: 2026-08-12.
- The product promise is approved language but is not a shipped capability until
  one complete Trail exists.
- The route name and URL remain open for later research and reader validation.
