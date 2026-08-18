#!/usr/bin/env python3
"""Renders the model A/B comparison report from two run JSONs.

    python3 scripts/model-ab/report.py luna.json mini.json out.html

Both runs saw the same candidate images (same brands, same gates, same
ordering), so every image is rendered once with the two models' verdicts side
by side rather than as two separate galleries.
"""
import json, sys, html, re
from datetime import datetime, timezone

A_PATH, B_PATH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
A = json.load(open(A_PATH))          # gpt-5.6-luna (production default)
B = json.load(open(B_PATH))          # gpt-4o-mini (challenger)
A_NAME, B_NAME = A["model"], B["model"]

VOCAB = set()
_src = open("src/lib/taxonomy/ontology.ts", encoding="utf-8").read()
VOCAB |= set(re.findall(r"nameZh:\s*'([^']+)'", _src))
for _m in re.findall(r"aliases:\s*\[([^\]]*)\]", _src):
    VOCAB |= set(re.findall(r"'([^']+)'", _m))

e = lambda s: html.escape(str(s))
ab = {b["slug"]: b for b in A["brands"]}
bb = {b["slug"]: b for b in B["brands"]}
SLUGS = [b["slug"] for b in A["brands"]]

# Fields worth showing, in reading order. Anything else present is appended.
FIELD_ORDER = [
    "name", "slug", "category", "subcategories", "subcategories_en",
    "price_range", "city", "founding_year",
    "blurb", "blurb_en", "description", "description_en",
    "mit_evidence", "reputation_summary", "channels",
    "purchase_website", "purchase_pinkoi", "purchase_shopee",
    "social_instagram", "social_threads", "social_facebook",
]


def fmt(v):
    if v is None:
        return '<span class="muted">—</span>'
    if isinstance(v, (dict, list)):
        return f'<code style="font-size:12px">{e(json.dumps(v, ensure_ascii=False, indent=1))}</code>'
    return e(v)


def tag_badge(tags):
    """Controlled-vocabulary compliance, the one field with an objective answer."""
    if not isinstance(tags, list) or not tags:
        return ""
    ok = [t for t in tags if t in VOCAB]
    cls = "good" if len(ok) == len(tags) else ("warn" if ok else "bad")
    return f' <span class="{cls}" style="font-size:11px">{len(ok)}/{len(tags)} in taxonomy</span>'


def usage_row(b):
    t, i = b["textUsage"], b["imageUsage"]
    return t["prompt"], t["completion"], i["prompt"], i["completion"], t["calls"], i["calls"]


# ---------------------------------------------------------------- cost model
COST_ROWS = []
for slug in SLUGS:
    for tag, run in (("a", ab[slug]), ("b", bb[slug])):
        tp, tc, ip, ic, tcalls, icalls = usage_row(run)
        COST_ROWS.append({"slug": slug, "side": tag, "tp": tp, "tc": tc, "ip": ip, "ic": ic,
                          "calls": tcalls + icalls})

parts = []
parts.append(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formoria — {e(A_NAME)} vs {e(B_NAME)}, curation A/B</title>
<style>
:root{{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a;--radius:10px}}
@media(prefers-color-scheme:dark){{:root{{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}}}}
:root[data-theme="dark"]{{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}}
:root[data-theme="light"]{{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Helvetica Neue","PingFang TC",sans-serif}}
.wrap{{max-width:1280px;margin:0 auto;padding:0 24px 90px}}
header{{border-bottom:1px solid var(--line);padding:40px 0 20px;margin-bottom:20px}}
h1{{margin:0 0 8px;font-size:30px;letter-spacing:-.02em}}
.sub{{color:var(--muted);margin:0;max-width:74ch}}
nav{{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:24px;z-index:5;display:flex;gap:14px;flex-wrap:wrap;font-size:13px}}
nav a{{color:var(--muted);text-decoration:none}}nav a:hover{{color:var(--accent)}}
h2{{font-size:22px;margin:0 0 14px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}}
h3{{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:26px 0 8px}}
.slug{{font-size:13px;color:var(--muted);font-weight:400}}
.live{{font-size:12px;font-weight:400;color:var(--accent);text-decoration:none}}
.lbl{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:12px 0 6px}}
.scroll{{overflow-x:auto}}
table{{border-collapse:collapse;width:100%;min-width:720px}}
th,td{{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}}
td{{word-break:break-word}}
thead th{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}}
table.cmp th:first-child{{width:15%;color:var(--muted);font-weight:500}}
table.cmp td{{width:42.5%}}
td.same{{color:var(--muted)}}
td.changed{{background:color-mix(in oklab,var(--accent) 13%,transparent)}}
td.num{{text-align:right;font-variant-numeric:tabular-nums;width:auto}}
.good{{color:var(--good);font-weight:700}}.warn{{color:var(--warn);font-weight:700}}.bad{{color:var(--bad);font-weight:700}}
.muted{{color:var(--muted)}}
.brand{{padding-top:30px;border-top:1px solid var(--line);margin-bottom:16px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin-bottom:6px}}
.tile{{position:relative;margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}}
.tile img{{display:block;width:100%;height:150px;object-fit:cover;background:var(--line)}}
.tile figcaption{{padding:6px 8px;font-size:10px;color:var(--muted)}}
.tile .l{{display:flex;justify-content:space-between;gap:6px;padding:2px 0}}
.tile .l span:first-child{{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.tile .s{{font-variant-numeric:tabular-nums;flex-shrink:0;font-weight:700}}
.tile b{{display:inline-block;font-size:9px;background:var(--line);border-radius:99px;padding:0 6px;margin:3px 3px 0 0}}
.tile.dropped{{opacity:.55}}
.verdict{{display:flex;gap:4px;align-items:baseline;font-size:10px;border-top:1px dashed var(--line);padding-top:3px;margin-top:3px}}
.verdict .who{{width:34px;flex-shrink:0;color:var(--accent);font-weight:700}}
.rank{{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.66);color:#fff;font-size:9px;padding:1px 7px;border-radius:99px}}
details{{margin-top:8px}}summary{{cursor:pointer;font-size:13px;color:var(--muted)}}
.callout{{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--radius);padding:16px 20px;margin-bottom:22px;font-size:14px}}
.callout.warn{{border-left-color:var(--warn)}}
.hl{{display:flex;gap:28px;flex-wrap:wrap;margin:0 0 22px}}
.hl div{{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 18px}}
.hl b{{display:block;font-size:26px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}}
.hl span{{font-size:12px;color:var(--muted)}}
.price{{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 18px;margin-bottom:16px}}
.price label{{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px}}
.price input{{width:96px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit;font-size:13px;font-variant-numeric:tabular-nums}}
</style></head><body><div class="wrap">
<header>
<h1>{e(A_NAME)} vs {e(B_NAME)} — curation A/B</h1>
<p class="sub">The same production pipeline run twice over three live brands, changing only the model. <b>Zero writes</b>: brand rows were read, never modified, and no audit row reached Postgres. Left column is <b>{e(A_NAME)}</b> (today's production default, reasoning off); right is <b>{e(B_NAME)}</b>.</p>
</header>
<nav><a href="#summary">Summary</a><a href="#cost">Cost</a><a href="#tokens">Tokens</a>""")
for slug in SLUGS:
    parts.append(f'<a href="#{e(slug)}">{e(ab[slug]["name"])}</a>')
parts.append("</nav>")

# ------------------------------------------------------------- highlights
tag_a = sum(len([t for t in (ab[s]["textPatch"].get("subcategories") or []) if t in VOCAB]) for s in SLUGS)
tag_a_all = sum(len(ab[s]["textPatch"].get("subcategories") or []) for s in SLUGS)
tag_b = sum(len([t for t in (bb[s]["textPatch"].get("subcategories") or []) if t in VOCAB]) for s in SLUGS)
tag_b_all = sum(len(bb[s]["textPatch"].get("subcategories") or []) for s in SLUGS)
img_a = sum(x["imageUsage"]["prompt"] for x in A["brands"])
img_b = sum(x["imageUsage"]["prompt"] for x in B["brands"])

parts.append(f"""
<div class="hl">
  <div><b>3</b><span>brands, identical inputs</span></div>
  <div><b>{tag_a}/{tag_a_all} → {tag_b}/{tag_b_all}</b><span>tags in taxonomy (luna → mini)</span></div>
  <div><b>{img_a:,} → {img_b:,}</b><span>image prompt tokens</span></div>
  <div><b>0</b><span>rows written to production</span></div>
</div>

<div class="callout">
<b>How this was run.</b> Each model ran the real phase chain — <code>discover, detect, slugs, clean, links</code> then <code>descriptions, locations, expansion, tags</code> — through <code>runEnrich</code> in <code>dryRun</code> mode, against synthetic refresh submissions held in memory. Because <code>dryRun</code> skips image classification outright, the image half re-runs the production modules directly: the same query builder, the same serper call, the same download gates, the same classifier prompt and parser, the same ranker. Both models saw an <b>identical candidate set</b> per brand, so every image below is one image with two verdicts.
</div>

<div class="callout warn">
<b>What this run does not settle.</b> One run per model, three brands — enough to expose systematic differences (taxonomy compliance, token cost), not enough to rank description quality. Classification is also not deterministic at <code>temperature 0.1</code>: an earlier {e(A_NAME)} run on <code>yates</code> kept 11 images where this one kept 5, from the same candidates. Treat single-brand image counts as noisy and the vocabulary and token columns as solid.
</div>""")

# ------------------------------------------------------------------ cost
parts.append(f"""
<h2 id="cost">Cost</h2>
<p class="sub" style="margin-bottom:14px">{e(B_NAME)} bills at a published <b>$0.15 / $0.60</b> per million tokens. I do not have a verified public rate for <b>{e(A_NAME)}</b> — the figure below is a gpt-5-tier placeholder, not a quote. Edit either pair and every number on the page recalculates.</p>
<div class="price">
  <div><label>{e(A_NAME)} input $/M</label><input id="ai" type="number" step="0.01" value="1.25"></div>
  <div><label>{e(A_NAME)} output $/M</label><input id="ao" type="number" step="0.01" value="10.00"></div>
  <div><label>{e(B_NAME)} input $/M</label><input id="bi" type="number" step="0.01" value="0.15"></div>
  <div><label>{e(B_NAME)} output $/M</label><input id="bo" type="number" step="0.01" value="0.60"></div>
</div>
<div class="scroll"><table>
<thead><tr><th>Brand</th><th class="num">{e(A_NAME)}</th><th class="num">{e(B_NAME)}</th><th class="num">Difference</th></tr></thead>
<tbody>""")
for slug in SLUGS:
    parts.append(f'<tr><td><a href="#{e(slug)}"><b>{e(ab[slug]["name"])}</b></a></td>'
                 f'<td class="num" data-cost="a:{e(slug)}"></td>'
                 f'<td class="num" data-cost="b:{e(slug)}"></td>'
                 f'<td class="num" data-cost="d:{e(slug)}"></td></tr>')
parts.append('<tr><td><b>All three</b></td><td class="num" data-cost="a:TOTAL"></td>'
             '<td class="num" data-cost="b:TOTAL"></td><td class="num" data-cost="d:TOTAL"></td></tr>')
parts.append('<tr><td class="muted">Per brand, average</td><td class="num muted" data-cost="a:AVG"></td>'
             '<td class="num muted" data-cost="b:AVG"></td><td class="num muted" data-cost="d:AVG"></td></tr>')
parts.append('<tr><td class="muted">Extrapolated: 139 brands</td><td class="num muted" data-cost="a:X139"></td>'
             '<td class="num muted" data-cost="b:X139"></td><td class="num muted" data-cost="d:X139"></td></tr>')
parts.append("</tbody></table></div>")

# ---------------------------------------------------------------- tokens
parts.append(f"""
<h2 id="tokens">Tokens per brand</h2>
<p class="sub" style="margin-bottom:14px">Text and image are billed the same but behave differently: the text half is nearly model-independent, while the image half is where {e(B_NAME)} explodes — it bills image tiles at roughly 33× the standard rate, so the same {e(A_NAME)} picture costs it four to five times as many prompt tokens.</p>
<div class="scroll"><table>
<thead><tr><th>Brand</th><th>Model</th><th class="num">Text in</th><th class="num">Text out</th><th class="num">Image in</th><th class="num">Image out</th><th class="num">Total</th><th class="num">Calls</th></tr></thead>
<tbody>""")
for slug in SLUGS:
    for label, run in ((A_NAME, ab[slug]), (B_NAME, bb[slug])):
        tp, tc, ip, ic, tcalls, icalls = usage_row(run)
        total = tp + tc + ip + ic
        hot = ' class="num bad"' if label == B_NAME and ip > 40000 else ' class="num"'
        parts.append(f'<tr><td>{e(ab[slug]["name"]) if label==A_NAME else ""}</td><td>{e(label)}</td>'
                     f'<td class="num">{tp:,}</td><td class="num">{tc:,}</td>'
                     f'<td{hot[1:]}>{ip:,}</td><td class="num">{ic:,}</td>'
                     f'<td class="num"><b>{total:,}</b></td><td class="num">{tcalls+icalls}</td></tr>')
ta = sum(sum(usage_row(ab[s])[k] for k in range(4)) for s in SLUGS)
tb = sum(sum(usage_row(bb[s])[k] for k in range(4)) for s in SLUGS)
parts.append(f'<tr><td><b>Total</b></td><td>{e(A_NAME)}</td><td class="num" colspan="4"></td><td class="num"><b>{ta:,}</b></td><td></td></tr>')
parts.append(f'<tr><td></td><td>{e(B_NAME)}</td><td class="num" colspan="4"></td><td class="num"><b>{tb:,}</b></td><td></td></tr>')
parts.append("</tbody></table></div>")

# --------------------------------------------------------------- summary
parts.append("""
<h2 id="summary">Summary</h2>
<div class="scroll"><table>
<thead><tr><th>Brand</th><th>Category</th><th class="num">Tags in taxonomy</th><th class="num">Images published</th><th class="num">Total tokens</th></tr></thead>
<tbody>""")
for slug in SLUGS:
    pa, pb = ab[slug]["textPatch"], bb[slug]["textPatch"]
    cat_a, cat_b = pa.get("category"), pb.get("category")
    cat_cls = ' class="changed"' if cat_a != cat_b else ""
    ta_ = pa.get("subcategories") or []
    tb_ = pb.get("subcategories") or []
    oa = len([t for t in ta_ if t in VOCAB])
    ob = len([t for t in tb_ if t in VOCAB])
    pub_a = sum(1 for i in ab[slug]["images"] if i.get("published"))
    pub_b = sum(1 for i in bb[slug]["images"] if i.get("published"))
    tot_a = sum(usage_row(ab[slug])[k] for k in range(4))
    tot_b = sum(usage_row(bb[slug])[k] for k in range(4))
    parts.append(
        f'<tr><td><a href="#{e(slug)}"><b>{e(ab[slug]["name"])}</b></a></td>'
        f'<td{cat_cls}>{e(cat_a)} → {e(cat_b)}</td>'
        f'<td class="num"><span class="good">{oa}/{len(ta_)}</span> → <span class="{"good" if ob==len(tb_) and tb_ else "bad"}">{ob}/{len(tb_)}</span></td>'
        f'<td class="num">{pub_a} → {pub_b}</td>'
        f'<td class="num">{tot_a:,} → {tot_b:,}</td></tr>')
parts.append("</tbody></table></div>")

# ------------------------------------------------------------- per brand
for slug in SLUGS:
    a, b = ab[slug], bb[slug]
    pa, pb = a["textPatch"], b["textPatch"]
    keys = [k for k in FIELD_ORDER if k in pa or k in pb]
    keys += sorted(k for k in set(pa) | set(pb) if k not in FIELD_ORDER)

    parts.append(f'<div class="brand"></div><h2 id="{e(slug)}">{e(a["name"])} '
                 f'<span class="slug">{e(slug)}</span> '
                 f'<a class="live" href="https://formoria.com/brands/{e(slug)}">live ↗</a></h2>')
    parts.append(f'<p class="sub">Routing branch <b>{e(a["routingBranch"])}</b> · image query <code>{e(a["imageQuery"])}</code> · '
                 f'{a["candidateCount"]} candidates, {sum(1 for i in a["images"] if i["gate"]=="kept")} passed the download gates.</p>')

    parts.append('<h3>Fields</h3><div class="scroll"><table class="cmp">'
                 f'<thead><tr><th></th><th>{e(A_NAME)}</th><th>{e(B_NAME)}</th></tr></thead><tbody>')
    for k in keys:
        va, vb = pa.get(k), pb.get(k)
        cls = "same" if va == vb else "changed"
        badge_a = tag_badge(va) if k == "subcategories" else ""
        badge_b = tag_badge(vb) if k == "subcategories" else ""
        parts.append(f'<tr><th>{e(k)}</th><td class="{cls}">{fmt(va)}{badge_a}</td>'
                     f'<td class="{cls}">{fmt(vb)}{badge_b}</td></tr>')
    parts.append("</tbody></table></div>")

    # images: one tile per candidate, two verdicts
    by_url_b = {i["url"]: i for i in b["images"]}
    kept = [i for i in a["images"] if i["gate"] == "kept"]
    kept.sort(key=lambda i: (i.get("rank") if i.get("rank") is not None else 999))
    parts.append(f'<h3>Images — {len(kept)} candidates, both models judging the same pictures</h3><div class="grid">')
    for img in kept:
        other = by_url_b.get(img["url"], {})
        drop = "" if (img.get("published") or other.get("published")) else " dropped"
        rank = f'<span class="rank">#{img["rank"]+1}</span>' if img.get("published") else ""

        def verdict(who, src):
            if not src.get("disposition"):
                return f'<div class="verdict"><span class="who">{who}</span><span class="muted">no verdict</span></div>'
            keep = src["disposition"] == "keep"
            mark = "keep" if keep else "reject"
            cls = "good" if keep else "bad"
            extra = e(src.get("tag") or "") if keep else e(", ".join(src.get("reasons") or []))
            pub = " · published" if src.get("published") else ""
            return (f'<div class="verdict"><span class="who">{who}</span>'
                    f'<span class="{cls}">{mark}</span><span class="s">{src.get("score", 0)}</span>'
                    f'<span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{extra}{pub}</span></div>')

        parts.append(
            f'<figure class="tile{drop}">{rank}'
            f'<img loading="lazy" src="{img.get("dataUri","")}" alt="">'
            f'<figcaption><div class="l"><span>{e(img["host"])}</span><span class="s">{img["w"]}×{img["h"]}</span></div>'
            f'{verdict("luna", img)}{verdict("mini", other)}'
            f'</figcaption></figure>')
    parts.append("</div>")

    dropped = [i for i in a["images"] if i["gate"] != "kept"]
    if dropped:
        parts.append(f'<details><summary>{len(dropped)} candidate(s) rejected by the download gates before either model saw them</summary><ul style="font-size:13px;color:var(--muted)">')
        for d in dropped:
            parts.append(f'<li>{e(d["host"])} — {e(d["gate"])} ({d["w"]}×{d["h"]})</li>')
        parts.append("</ul></details>")

    parts.append('<details><summary>Phase timings</summary><div class="scroll"><table>'
                 f'<thead><tr><th>Phase</th><th>{e(A_NAME)}</th><th>{e(B_NAME)}</th></tr></thead><tbody>')
    pmap_a = {p["phase"]: p for p in a["textPhases"]}
    pmap_b = {p["phase"]: p for p in b["textPhases"]}
    for ph in sorted(set(pmap_a) | set(pmap_b)):
        x, y = pmap_a.get(ph, {}), pmap_b.get(ph, {})
        parts.append(f'<tr><th>{e(ph)}</th>'
                     f'<td>{e(x.get("status","—"))} · {x.get("durationMs",0)/1000:.1f}s</td>'
                     f'<td>{e(y.get("status","—"))} · {y.get("durationMs",0)/1000:.1f}s</td></tr>')
    parts.append("</tbody></table></div></details>")

parts.append(f"""
<p class="sub" style="margin-top:40px;font-size:12px">Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} ·
{e(A_NAME)} run {e(A['ranAt'])} · {e(B_NAME)} run {e(B['ranAt'])} ·
{len(A['blockedWrites'])} and {len(B['blockedWrites'])} writes intercepted and dropped respectively, all of them audit rows.</p>
<script>
const ROWS = {json.dumps(COST_ROWS)};
const SLUGS = {json.dumps(SLUGS)};
const money = (v) => v >= 1 ? '$' + v.toFixed(2) : '$' + v.toFixed(4);
function recalc() {{
  const p = {{
    a: {{i: +document.getElementById('ai').value, o: +document.getElementById('ao').value}},
    b: {{i: +document.getElementById('bi').value, o: +document.getElementById('bo').value}},
  }};
  const cost = {{}};
  for (const r of ROWS) {{
    const rate = p[r.side];
    const c = ((r.tp + r.ip) * rate.i + (r.tc + r.ic) * rate.o) / 1e6;
    cost[r.side + ':' + r.slug] = c;
  }}
  for (const side of ['a', 'b']) {{
    cost[side + ':TOTAL'] = SLUGS.reduce((s, g) => s + cost[side + ':' + g], 0);
    cost[side + ':AVG'] = cost[side + ':TOTAL'] / SLUGS.length;
    cost[side + ':X139'] = cost[side + ':AVG'] * 139;
  }}
  for (const key of [...SLUGS, 'TOTAL', 'AVG', 'X139']) {{
    cost['d:' + key] = cost['a:' + key] - cost['b:' + key];
  }}
  document.querySelectorAll('[data-cost]').forEach((el) => {{
    const key = el.getAttribute('data-cost');
    const v = cost[key];
    if (v === undefined) return;
    if (key.startsWith('d:')) {{
      const cheaper = v > 0 ? 'mini cheaper by ' : 'luna cheaper by ';
      el.textContent = cheaper + money(Math.abs(v));
      el.className = el.className.replace(/ (good|bad)/g, '') + (v > 0 ? ' bad' : ' good');
    }} else {{
      el.textContent = money(v);
    }}
  }});
}}
['ai', 'ao', 'bi', 'bo'].forEach((id) => document.getElementById(id).addEventListener('input', recalc));
recalc();
</script>
</div></body></html>""")

open(OUT, "w", encoding="utf-8").write("".join(parts))
print(f"wrote {OUT}")
