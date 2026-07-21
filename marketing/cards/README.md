# Formoria 圖卡 (Social Card) Engine

Image-led 1080×1350 social cards for Formoria / 島藏, built on the global `/content-cards` skill. v1 is **ZH-TW only**, **manual posting** (no scheduler / Meta API).

## What's in this directory

- `theme.json` — design tokens: palette, type scale (Noto Sans TC), `background.scrim` stops by card type, `accentRules` keyed by background mode, and `cards.templateDir`.
- `templates/` — HTML templates with `{{TOKEN}}` placeholders: `cover.html`, `text.html` (content modes: bullets / prose / numbered / quote / keyword / big-statement), `cta.html`, `brand-highlight.html`.
- Card set briefs live in `marketing/items/<dir>/brief.md` (e.g. `../items/2026-07-21-intro-carousel/brief.md`): per-card type, template, mode, background, and ZH-TW copy.

## How to generate a card set

1. Author or pick a brief in `marketing/items/<dir>/brief.md`. Each card entry specifies: type, template, mode, background `{type, value, scrim}`, and copy.
2. For image-mode cards, source a photo (founder-supplied or AI-generated) pre-cropped to 1080×1350.
3. Run `/content-cards` pointed at this engine:
   ```
   /content-cards --config=marketing/cards/theme.json --template-dir=marketing/cards/templates lang=zh
   ```
   The skill reads each template from `templateDir` (falling back to the global template set), substitutes tokens, computes the `background` fill + scrim gradient + adaptive `accentRule` colors, base64-embeds images, and writes self-contained HTML.
4. Render each HTML to PNG with Playwright at **1080×1350**, awaiting `document.fonts.ready` (Noto Sans TC loads via Google Fonts).

   > **Note:** The `file:` protocol is blocked in Playwright MCP. Serve the output directory over HTTP first:
   > ```
   > python3 -m http.server 8731 --bind 127.0.0.1
   > ```
   > Run this from inside the output directory, then navigate to `http://127.0.0.1:8731/card-NN.html`.

5. Outputs land in `docs/content/cards/<slug>/card-NN.png` (gitignored — generated artifacts).

## Add a new card type or set

- **New set (same look):** add a brief in `marketing/items/<dir>/brief.md` and reuse the existing templates — no skill or template change needed.
- **New card type:** add `templates/<type>.html` using the token contract below; reference it from a brief.

## Token contract

Placeholders found across all four templates, grouped by role:

### Shared (all templates)

| Token | Description |
|---|---|
| `{{LANG}}` | HTML `lang` attribute, e.g. `zh-TW` |
| `{{FONT_HEADING}}` | Heading font-family string |
| `{{FONT_BODY}}` | Body font-family string |
| `{{WORDMARK_ZH}}` | ZH wordmark text — `島藏` |
| `{{WORDMARK_EN}}` | EN wordmark text — `Formoria` |
| `{{BG_IMAGE}}` | Background image URL or base64 data URI; hidden when empty |
| `{{BG_FILL}}` | Solid `background-color` fallback (shown when no image, or beneath image) |
| `{{SCRIM}}` | CSS gradient string for the scrim overlay (computed from `theme.background.scrim`) |
| `{{BAR_COLOR}}` | Left 6 px accent bar color |
| `{{STRIP_BG}}` | Bottom 32 px strip background color |
| `{{TEXT}}` | Primary text color |
| `{{COUNTER_COLOR}}` | Page counter color in the bottom strip |
| `{{FOOTER}}` | Footer label in the bottom-left strip (e.g. platform handle) |
| `{{PAGE_NUM}}` | Page counter in the bottom-right strip — format `NN / total` (total is dynamic) |

### Content (per-template)

| Token | Templates | Description |
|---|---|---|
| `{{HEADLINE}}` | cover, text, cta | Main headline; collapses when empty |
| `{{SUBHEAD}}` | cover | Subheading below the headline |
| `{{TAG}}` | text, cta | Tag pill above the headline; collapses when empty |
| `{{BODY}}` | text | Body content block; rendered according to `{{MODE}}` |
| `{{MODE}}` | text | CSS class suffix driving layout: `bullets`, `prose`, `numbered`, `quote`, `keyword`, `big-statement` |
| `{{CTA_LABEL}}` | cta | CTA button label |
| `{{CTA_NOTE}}` | cta | Per-platform sub-note below the button |
| `{{CTA_BTN_BG}}` | cta | CTA button background color |
| `{{CTA_BTN_TEXT}}` | cta | CTA button text color |
| `{{BADGE}}` | brand-highlight | MIT 微笑認證 badge text; collapses when empty |
| `{{CAT_TAG}}` | brand-highlight | Category tag pill; collapses when empty |
| `{{BRAND_NAME}}` | brand-highlight | Brand Chinese name (72 px) |
| `{{BRAND_EN}}` | brand-highlight | Brand English name |
| `{{META}}` | brand-highlight | Meta line below the rule (e.g. founded year, location) |

### Color / adaptive (computed from accentRules)

| Token | Description |
|---|---|
| `{{ACCENT}}` | Accent color used for bullet dots, numbered counters, quote mark, and badge background |
| `{{TAG_BORDER}}` | Tag pill border color |
| `{{TAG_TEXT}}` | Tag pill text color |
| `{{RULE_COLOR}}` | Decorative horizontal rule color |

## Background modes and accent adaptation

Values are drawn from `theme.accentRules` in `theme.json`:

| Background mode | Accent color | Tag / rule / bar / counter | CTA button |
|---|---|---|---|
| `image` or `dark` | Terracotta `#C4693B` | `#C4693B` | Cream bg `#FFFDF8` / terracotta text |
| `color` → green `#2F5D50` | White-tint `#FFFFFF66` border, `#FFFDF8` text/rule | `#FFFDF8` strip | Cream bg / green text |
| `color` → terracotta `#C4693B` | White-tint `#FFFFFF40` border/bar, `#FFFDF8` text/rule | `#FFFDF8` counter | Cream bg / terracotta text |

Scrim gradient stops per card type (from `theme.background.scrim`):

| Card type | Gradient stops (position → opacity) |
|---|---|
| `cover` | 0 → 0%, 30% → 40%, 100% → 80% |
| `bullets` | 0 → 20%, 35% → 47%, 100% → 85% |
| `quote` | 0 → 33%, 40% → 60%, 100% → 90% |
| `brandHighlight` | 0 → 0%, 45% → 0%, 100% → 80% |

## Series catalog (build later)

Templates and theme are reusable for these future sets — each needs only a new brief. `brand-highlight.html` is already shipped for the first series below.

| Series | Template | Mode | Gate |
|---|---|---|---|
| **Brand highlight** — one card per listed brand; optional MIT 微笑認證 badge | `brand-highlight.html` | — | ~12+ listed brands |
| **Founder / behind-the-scenes** — founder voice, quotes | `text.html` | `quote` / `prose` | — |
| **Category highlight** — one set per taxonomy category | `text.html` | `bullets` / `keyword` | — |
| **"Top 5" / curated lists** | `text.html` | `numbered` | — |
| **"Newly listed" drops** | `text.html` | `bullets` | — |

## Notes and open items

- **v1 ZH-TW only.** Bilingual support is deferred. Distribution is manual native upload (IG, Threads).
- **Image sourcing** is a content-time concern. The engine consumes an image path per card; it does not source or generate images.
- **Logo asset:** `theme.brand.logo` is `null`. The v1 placeholder is the text wordmark 島藏 / Formoria rendered in Noto Sans TC.
- **Pending founder sign-off** (see `../items/2026-07-21-intro-carousel/brief.md` TODOs): cover tagline wording, founder quote wording, IG / Threads handles.
