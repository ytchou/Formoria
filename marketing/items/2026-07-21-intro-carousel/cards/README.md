# Intro carousel — card render notes

8 self-contained HTML cards (1080×1350), tokens substituted from `marketing/cards/theme.json` + `marketing/cards/templates/`. Card 08 has separate `-threads` / `-ig` variants for the platform-specific `ctaNote` (per brief.md).

**Not yet done — needs a follow-up pass once inputs land:**
- Cards 01, 04, 05, 06 are `background.type: image` per brief.md, but no source photos exist yet (`images/*.jpg` paths in brief.md are still TODO). Rendered here with the dark (`#1C1C1C`) fallback fill instead — swap in real photos and re-render once founder supplies/approves them.
- Card 05 (founder quote) uses a green accent override per brief.md's `tagAccent: green`, but the quote wording itself is still pending founder sign-off (see brief.md TODOs).
- Card 01 headline/tagline is pending founder sign-off (see brief.md TODOs).
- PNG export: this environment has no browser/Playwright tool available, so only the HTML is produced here. Per `marketing/cards/README.md`, serve this directory over HTTP and render each `card-NN.html` to PNG with Playwright at 1080×1350 (await `document.fonts.ready`) once ready to post.
