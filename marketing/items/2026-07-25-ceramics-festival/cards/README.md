# Ceramics biennial — card render notes

3 self-contained HTML cards (1080×1350), all `background.type: color`/`dark` — no source photos needed. Card 03 has separate `-threads` / `-ig` variants for the platform-specific `ctaNote`.

**Not yet done — needs a follow-up pass once inputs land:**
- brief.md's "Reference brands" are unresolved placeholders (`placeholder-ceramics-1/2/3`). No database access was used to fill these in, so the brief's second key point (naming 3 exhibiting ceramics brands Formoria has listed) is not rendered as its own card — inventing names would misrepresent which brands are actually catalogued. Once editorial/DB confirms 3 real exhibiting brands, add a `numbered` or `brand-highlight.html` card between cards 02 and 03.
- Exhibition venue/location isn't in brief.md, so card 02 only states the dates (8/1–10/31) — add location if/when confirmed.
- PNG export: no browser/Playwright tool available in this environment — only HTML is produced. Serve over HTTP and render with Playwright at 1080×1350 per `marketing/cards/README.md` before posting.
