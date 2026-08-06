# 350-brand milestone — card render notes

5 self-contained HTML cards (1080×1350), all `background.type: color` (green/terracotta/dark) — no source photos needed. Card 05 has separate `-threads` / `-ig` variants for the platform-specific `ctaNote`.

**Not yet done — needs a follow-up pass once inputs land:**
- brief.md's "Reference brands" are unresolved placeholders (`placeholder-brand-1/2/3`). No database access was used to fill these in, so this card set stays at the category level (保養/陶藝/食品/生活用品/服飾) instead of naming specific brands. If editorial supplies 2-3 confirmed brand names, add a `brand-highlight.html` card per brand (see series catalog in `marketing/cards/README.md`) between cards 03 and 04.
- PNG export: no browser/Playwright tool available in this environment — only HTML is produced. Serve over HTTP and render with Playwright at 1080×1350 per `marketing/cards/README.md` before posting.
