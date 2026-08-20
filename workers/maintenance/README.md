# Production maintenance gate (DEV-1530)

A Cloudflare Worker that closes `formoria.com` behind a branded zh-TW **503**
holding page, so the staging→production cutover (DEV-1531) can run without any
of it being publicly visible.

It returns 503, never 200. A 200 "coming soon" page gets indexed _as_ the site's
content; a 503 is the documented planned-maintenance signal, so crawlers back
off and retry without anything being indexed or de-indexed.

**Ceiling: ~2 weeks.** Google tolerates a sustained 503 as planned maintenance
for roughly two weeks, then starts dropping pages. That is a deadline, not a
target.

## Deploy

```bash
cd workers/maintenance
pnpm dlx wrangler login              # once, if not already authenticated
pnpm dlx wrangler secret put GATE_BYPASS_TOKEN   # paste a long random string
pnpm dlx wrangler deploy
```

`GATE_BYPASS_TOKEN` is optional. Without it the gate simply has no bypass — it
fails closed rather than opening on an empty value. Set it if you want to check
your own cutover work through the gate (you do).

Generate one with `openssl rand -hex 32`.

## Verify

The ticket's acceptance checks:

```bash
curl -sI https://formoria.com/            | head -1   # HTTP/2 503
curl -sI https://formoria.com/            | grep -i retry-after
curl -sI https://formoria.com/brands/<slug> | head -1 # 503 on a deep path too
curl -sI https://formoria.com/api/health  | head -1   # 503 on the API surface
curl -sI -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
     https://formoria.com/ | head -1                   # 503 for Googlebot as well
```

Then open `https://formoria.com/` in a browser: warm paper ground, the wordmark,
the zh-TW message, no broken assets, no network requests beyond the document.

Two headers that must **not** appear: `X-Robots-Tag: noindex` (it would
de-index, the opposite of the intent) and any cacheable `Cache-Control` (a
cached 503 outlives the gate being lifted).

## See the real site while the gate is up

```
https://formoria.com/?gate-bypass=<GATE_BYPASS_TOKEN>
```

That mints an `HttpOnly` cookie and redirects to the clean URL, so the token
stops travelling in the address bar and in `Referer` after the first hop. The
cookie lasts 14 days — the same ceiling as the gate itself. Clear it from
devtools to see the holding page again.

## Lift the gate

**No deploy required.** In the Cloudflare dashboard: _Workers & Pages →
formoria-maintenance-gate → Settings → Domains & Routes → disable_ both routes.
Effective at the edge immediately.

Re-apply by re-enabling them. The Worker itself can stay deployed between
windows; the routes are the switch.

To remove it entirely: `pnpm dlx wrangler delete`.

## Why a Worker and not `src/proxy.ts`

The in-app proxy is already the request chokepoint for every request and would
be cleaner code. It cannot cover the window where the app itself is down,
mid-deploy, or pointed at the wrong Supabase project — which is exactly the
window this gate exists for.

## Design

The page follows `docs/designs/ux/DESIGN.md` v2: ground `#FAF7F2`, ink
`#1A1815`, ink-muted `#6F685F`, hairline `#DED5C8`, and the 藍染 accent `#2F4F63`
used exactly once, on the only link on the page.

Typeface is a **黑體 system stack only**, per DESIGN.md §1 **D17** — the rule for
surfaces that sit outside `next/font`. No webfont, no stylesheet, no image, no
script: the page makes zero subrequests, because it has to render while the
origin is being redeployed.

## Not in the app tsconfig

`tsconfig.json` excludes `workers`, the same way it already excludes
`supabase/functions`. Both are non-Next.js runtimes with their own globals;
type-checking them against the app's `lib` reports errors that mean nothing.
Wrangler bundles the TypeScript itself.
