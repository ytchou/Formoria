/**
 * The holding page, as a string.
 *
 * SELF-CONTAINED ON PURPOSE. This page's whole job is to render while the
 * origin is being redeployed and repointed, so it makes zero subrequests: no
 * stylesheet, no webfont, no image, no script. Everything is one inline
 * <style> block.
 *
 * TYPEFACE — 黑體 SYSTEM STACK ONLY, NEVER 明體.
 * `docs/designs/ux/DESIGN.md` §1 D17 governs surfaces that sit outside
 * `next/font` (email templates, `next/og` routes, marketing cards): they use a
 * sans system stack and align with the rest of the system through colour,
 * spacing and layout instead. A Cloudflare Worker could technically link a CDN
 * font — it serves its own CSP — but doing so would put an external dependency
 * on the one page that exists for when things are down, and would render the
 * headline in a face the app itself never self-hosts. So the 明體 content face
 * is deliberately absent here and the identity is carried by colour, the
 * 96/32/24px rhythm, and the hairline rule.
 *
 * COLOUR — the v2 tokens, copied as literals.
 * The values below are the generated table in DESIGN.md §9, not hand-picked
 * approximations. `--ink-muted` is `#6F685F` (5.14:1 on ground); §2's prose
 * still reads `#7A736A`, which is stale — §9 is generated from
 * `src/app/globals.css` and is the one that matches the app.
 *
 * The accent (藍染 `#2F4F63`) appears EXACTLY ONCE, on the mailto link. DESIGN.md
 * §2 reserves it for interaction and says "never decorative" — so the divider
 * under the wordmark is `--rule`, the hairline token, not the accent. That is a
 * deliberate departure from the approved sketch, which drew that divider in
 * accent.
 */
export const MAINTENANCE_PAGE = `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Formoria</title>
<meta name="description" content="Formoria 正在重新整理站上的內容，很快會再打開。">
<style>
:root {
  /* Design system v2 — docs/designs/ux/DESIGN.md §9 (generated). */
  color-scheme: light;
  --ground: #FAF7F2;
  --ink: #1A1815;
  --ink-muted: #6F685F;
  --rule: #DED5C8;
  --accent: #2F4F63;
  --space-section: 96px;
  --space-stack: 32px;
  --space-gutter: 24px;
  /* D17: 黑體 only. The app's own fallback chain, minus the self-hosted face. */
  --font-hei: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Heiti TC", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-hei);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
main {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  /* --space-gutter inline, --space-section block. The named rhythm, used as
     named — DESIGN.md §3 forbids inventing a scale beyond these three. */
  padding: var(--space-section) var(--space-gutter);
  margin: 0 auto;
  max-width: 34rem;
}
.wordmark {
  /* type-card-title metrics (1.3125rem / 600 / 1.35), rendered in 黑體 per D17. */
  margin: 0;
  font-size: 1.3125rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
}
.divider {
  /* Elevation is borders, not shadows (DESIGN.md §7). --rule, never --accent. */
  width: 32px;
  height: 1px;
  margin: var(--space-gutter) 0 0;
  border: 0;
  background: var(--rule);
}
h1 {
  /* type-display metrics. The 2.875rem token is the DESKTOP ceiling: a 12-字
     zh-TW headline at 46px is 552px wide and overflows a 390px viewport, so the
     clamp floors it at 2rem and the token stays the top of the range. */
  margin: var(--space-stack) 0 0;
  font-size: clamp(2rem, 6vw, 2.875rem);
  /* 560 is a variable-font weight with no system equivalent; 600 is the nearest
     real cut in PingFang TC and Noto Sans TC. */
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--ink);
}
/*
 * WHERE THE HEADLINE IS ALLOWED TO BREAK.
 *
 * CJK has a break opportunity between any two Han characters, so a 12-字
 * headline in a 34rem measure breaks wherever the line happens to run out:
 * greedy wrapping stranded 內容 alone on line two, and "text-wrap: balance"
 * split 整理 down the middle, which is worse — it severs a word.
 *
 * Each span is nowrap, so the ONLY surviving break point is the seam between
 * them, which is a real word boundary. This holds at every viewport rather than
 * relying on a hard line break that would be wrong on one of them.
 */
h1 span {
  white-space: nowrap;
}
.lede {
  /* type-body metrics (1.03125rem / 1.75), ink-muted — 5.14:1 on ground. */
  margin: var(--space-stack) 0 0;
  font-size: 1.03125rem;
  line-height: 1.75;
  color: var(--ink-muted);
}
.contact {
  /* type-metadata metrics (0.75rem / 500 / 1.4). */
  margin: var(--space-stack) 0 0;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ink-muted);
}
.contact a {
  /* The only interaction on the page, and therefore the only accent on it. */
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 2px;
}
.contact a:hover { border-bottom-color: var(--accent); }
.contact a:focus-visible {
  /* DESIGN.md §6: every interactive element has a drawn focus state, 2px accent. */
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 2px;
}
footer {
  /* The byte-pinned footer tagline, above a full-width hairline. */
  padding: var(--space-stack) var(--space-gutter);
  border-top: 1px solid var(--rule);
  text-align: center;
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--ink-muted);
}
</style>
</head>
<body>
<main>
<p class="wordmark">Formoria</p>
<hr class="divider">
<h1><span>我們正在重新整理</span><span>站上的內容</span></h1>
<p class="lede">Formoria 很快會再打開。<br>在這之前，謝謝你的等待。</p>
<p class="contact"><a href="mailto:hello@formoria.com">hello@formoria.com</a></p>
</main>
<footer>生活可以更像自己一點</footer>
</body>
</html>
`;
