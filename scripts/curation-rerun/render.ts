/**
 * Renders a cohort's production before/after comparison from two snapshots.
 *
 * Both sides are real `brands` rows, so unlike the submission-based benchmark
 * there is no `enriched_data` indirection — every value on both sides is read
 * straight off the column the site renders from.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/render.ts
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/render.ts --cohort batch1-never-curated
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadCohort, snapshotDir } from "./cohort";

const ARTIFACT_ROOT = `${process.env.HOME}/project/.artifact/formoria`;

/** review_<cohort>_<YYYY-MM-DD-HHmmss>.html, matching the existing artifact naming. */
function artifactPath(cohortName: string): string {
  const t = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
  return resolve(ARTIFACT_ROOT, `review_${cohortName}_${stamp}.html`);
}

type Img = Record<string, unknown> & {
  url: string;
  brand_id: string;
  source: string | null;
  provider_metadata: Record<string, unknown> | null;
  source_url: string | null;
  status: string | null;
  score: number | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  sort_order: number | null;
  alt_zh: string | null;
  rejection_reasons: string[] | null;
};
type Brand = Record<string, unknown> & {
  id: string;
  slug: string;
  name: string;
};
type Snapshot = {
  capturedAt: string;
  brands: Brand[];
  children: Record<string, Img[]>;
};

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const hostOf = (u: string | null | undefined): string => {
  if (!u) return "—";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "?";
  }
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join("、");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    return JSON.stringify(value);
  }
  return String(value);
}

const LINK_FIELDS = [
  "purchase_website",
  "social_instagram",
  "social_threads",
  "social_facebook",
  "purchase_pinkoi",
  "purchase_shopee",
] as const;

const IDENTITY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["name", "Name"],
  ["slug", "Slug"],
  ["product_type", "Category"],
  ["product_tags", "Product tags"],
  ["city", "City"],
  ["founding_year", "Founded"],
  ["price_range", "Price range"],
];

const CONTENT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["blurb", "Blurb (zh)"],
  ["blurb_en", "Blurb (en)"],
  ["description", "Description (zh)"],
  ["description_en", "Description (en)"],
  ["reputation_summary", "Reputation"],
];

function cmpRow(label: string, before: unknown, after: unknown): string {
  const b = show(before);
  const a = show(after);
  const cls =
    b === a ? "same" : !b && a ? "gained" : b && !a ? "lost" : "changed";
  return `<tr>
    <th>${esc(label)}</th>
    <td class="same">${b ? esc(b) : '<span class="muted">—</span>'}</td>
    <td class="${cls}">${a ? esc(a) : '<span class="muted">—</span>'}</td>
  </tr>`;
}

function tile(i: Img, published: boolean): string {
  const meta = (i.provider_metadata ?? {}) as Record<string, unknown>;
  const method = (meta.method as string) ?? i.source ?? "?";
  const label =
    i.status === "rejected"
      ? `reject: ${(i.rejection_reasons ?? []).join(", ") || "—"}`
      : i.score === null && i.status === "candidate"
        ? "never classified"
        : "";
  return `<figure class="tile${published ? "" : " dropped"}">
    ${published ? `<span class="rank">${i.sort_order === 0 ? "hero" : i.sort_order}</span>` : ""}
    <img src="${esc(i.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <figcaption>
      <div class="l"><span>${esc(hostOf(i.source_url ?? i.url))}</span><span class="d">${i.width || "?"}×${i.height || "?"}</span></div>
      <div class="l"><span class="m">${esc(String(method))}</span><span class="s">${i.score ?? "—"}</span></div>
      ${(i.tags ?? []).map((t) => `<b>${esc(t)}</b>`).join("")}
      ${label ? `<div class="bad">${esc(label)}</div>` : ""}
      ${i.alt_zh ? `<div class="alt">${esc(i.alt_zh)}</div>` : ""}
    </figcaption>
  </figure>`;
}

/**
 * What the run cost, per brand and per phase, read from the audit rows the
 * pipeline wrote as it went.
 *
 * `cost_usd` is denormalised onto `brand_ai_results` at write time from the
 * provider's own token counts, so this bills the calls that actually happened
 * rather than re-deriving them from a price list here. A null `cost_usd` means
 * unmeasured, never free — a failed call has no usage block to price — so nulls
 * are counted separately as `unpriced` instead of being summed as zero.
 */
type PhaseCost = {
  phase: string;
  model: string;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
  unpriced: number;
};
type BrandCost = {
  total: number;
  unpriced: number;
  calls: number;
  phases: PhaseCost[];
};

type RefreshLog = {
  jobIds?: string[];
  requested?: Array<{ slug: string; submissionId: string | null }>;
};

/**
 * Every `refresh-log-*.json` in the cohort's snapshot dir.
 *
 * All of them, not just the newest: a cohort assembled from more than one run —
 * a second wave of brands, or a re-run of a subset — has one log per job, and
 * billing only the newest would report the earlier wave's brands as free.
 */
async function loadRefreshLogs(dir: string): Promise<RefreshLog[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => e.startsWith("refresh-log-") && e.endsWith(".json"))
    .sort();
  const logs: RefreshLog[] = [];
  for (const name of names) {
    try {
      logs.push(
        JSON.parse(await readFile(resolve(dir, name), "utf8")) as RefreshLog,
      );
    } catch {
      // A truncated log costs this run its cost column, never the render.
    }
  }
  return logs;
}

/**
 * The job(s) to bill.
 *
 * The log is the fast path, but logs written before `jobIds` was recorded have
 * to fall back to the newest job that actually wrote audit rows for these
 * brands. Without the fallback, re-rendering an earlier run silently bills
 * nothing, which reads identically to "the run was free".
 */
async function resolveJobIds(
  supabase: SupabaseClient,
  brandIds: string[],
  logs: RefreshLog[],
): Promise<string[]> {
  const fromLogs = [...new Set(logs.flatMap((l) => l.jobIds ?? []))];
  if (fromLogs.length > 0) return fromLogs;
  if (brandIds.length === 0) return [];
  const { data } = await supabase
    .from("brand_ai_results")
    .select("job_id, created_at")
    .in("brand_id", brandIds)
    .not("job_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const newest = (data ?? []).at(0) as { job_id: string } | undefined;
  return newest ? [newest.job_id] : [];
}

/**
 * Costs keyed by slug.
 *
 * Audit rows carry `brand_id` even when the enrichment target was a refresh
 * submission — `submission_id` is null on every row — so the join is on the
 * brand, resolved through the after-snapshot rather than a second query.
 *
 * Rows with a null `job_id` are excluded by the job filter, and that is load
 * bearing: `insertTriageResult` / `insertReputationResult` write result-shaped
 * rows carrying no usage, and counting them would inflate the call count with
 * calls that were already billed under their audit row.
 */
async function loadCosts(
  supabase: SupabaseClient,
  jobIds: string[],
  slugByBrandId: Map<string, string>,
): Promise<Map<string, BrandCost>> {
  const out = new Map<string, BrandCost>();
  if (jobIds.length === 0) return out;

  const { data, error } = await supabase
    .from("brand_ai_results")
    .select(
      "brand_id, phase, model, cost_usd, prompt_tokens, cached_prompt_tokens, completion_tokens",
    )
    .in("job_id", jobIds);
  if (error) {
    console.warn(
      `  cost lookup failed (${error.message}) — rendering without the cost section`,
    );
    return out;
  }

  type Row = {
    brand_id: string | null;
    phase: string;
    model: string;
    cost_usd: number | null;
    prompt_tokens: number | null;
    cached_prompt_tokens: number | null;
    completion_tokens: number | null;
  };
  for (const row of (data ?? []) as Row[]) {
    const slug = row.brand_id ? slugByBrandId.get(row.brand_id) : undefined;
    if (!slug) continue;
    const brand = out.get(slug) ?? {
      total: 0,
      unpriced: 0,
      calls: 0,
      phases: [],
    };
    const key = `${row.phase}::${row.model}`;
    let phase = brand.phases.find((p) => `${p.phase}::${p.model}` === key);
    if (!phase) {
      phase = {
        phase: row.phase,
        model: row.model,
        calls: 0,
        promptTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        unpriced: 0,
      };
      brand.phases.push(phase);
    }
    phase.calls += 1;
    phase.promptTokens += row.prompt_tokens ?? 0;
    phase.cachedTokens += row.cached_prompt_tokens ?? 0;
    phase.completionTokens += row.completion_tokens ?? 0;
    if (row.cost_usd === null) phase.unpriced += 1;
    else phase.costUsd += Number(row.cost_usd);
    brand.calls += 1;
    brand.total += Number(row.cost_usd ?? 0);
    brand.unpriced += row.cost_usd === null ? 1 : 0;
    out.set(slug, brand);
  }
  for (const brand of out.values())
    brand.phases.sort((l, r) => r.costUsd - l.costUsd);
  return out;
}

/** 4 dp: a single phase can land near $0.0001 and rounding to cents shows $0.00. */
const usd = (n: number): string => `$${n.toFixed(4)}`;
const num = (n: number): string => n.toLocaleString("en-US");

function costTable(cost: BrandCost | undefined): string {
  if (!cost || cost.calls === 0) {
    return '<p class="muted">No audit rows recorded for this brand in the billed job.</p>';
  }
  const rows = cost.phases
    .map(
      (p) => `<tr>
      <th>${esc(p.phase)}</th>
      <td class="same">${esc(p.model)}</td>
      <td class="num">${p.calls}</td>
      <td class="num">${num(p.promptTokens)}${p.cachedTokens ? ` <span class="muted">(${num(p.cachedTokens)} cached)</span>` : ""}</td>
      <td class="num">${num(p.completionTokens)}</td>
      <td class="num">${usd(p.costUsd)}${p.unpriced ? ` <span class="bad">+${p.unpriced} unpriced</span>` : ""}</td>
    </tr>`,
    )
    .join("");
  return `<div class="scroll"><table class="cmp">
    <thead><tr><th>Phase</th><th>Model</th><th class="num">Calls</th><th class="num">Prompt tokens</th><th class="num">Completion tokens</th><th class="num">Cost</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Total</th><td class="same"></td><td class="num">${cost.calls}</td><td class="num"></td><td class="num"></td><td class="num"><b>${usd(cost.total)}</b></td></tr></tfoot>
  </table></div>`;
}

const byBrand = (imgs: Img[]): Map<string, Img[]> => {
  const map = new Map<string, Img[]>();
  for (const i of imgs) {
    const list = map.get(i.brand_id) ?? [];
    list.push(i);
    map.set(i.brand_id, list);
  }
  return map;
};

const sortImgs = (imgs: Img[]): Img[] =>
  imgs.slice().sort((l, r) => (l.sort_order ?? 99) - (r.sort_order ?? 99));

async function main(): Promise<void> {
  const cohort = await loadCohort();
  const dir = snapshotDir(cohort);
  const argAfter = process.argv.indexOf("--after");
  const argBefore = process.argv.indexOf("--before");
  const beforeFile = resolve(
    dir,
    argBefore === -1 ? "before.json" : String(process.argv.at(argBefore + 1)),
  );
  const afterFile = resolve(
    dir,
    argAfter === -1 ? "after.json" : String(process.argv.at(argAfter + 1)),
  );

  const before = JSON.parse(await readFile(beforeFile, "utf8")) as Snapshot;
  const after = JSON.parse(await readFile(afterFile, "utf8")) as Snapshot;

  // Cost is best-effort: a missing log or an unreachable DB degrades to a page
  // without the cost section rather than failing a render of a run that has
  // already mutated production.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const logs = await loadRefreshLogs(dir);
  const slugByBrandId = new Map(after.brands.map((b) => [b.id, b.slug]));
  const jobIds = await resolveJobIds(supabase, [...slugByBrandId.keys()], logs);
  const costs = await loadCosts(supabase, jobIds, slugByBrandId);
  const grandTotal = [...costs.values()].reduce((n, c) => n + c.total, 0);
  const totalCalls = [...costs.values()].reduce((n, c) => n + c.calls, 0);
  const totalUnpriced = [...costs.values()].reduce((n, c) => n + c.unpriced, 0);

  const bBrand = new Map(before.brands.map((b) => [b.slug, b]));
  const aBrandById = new Map(after.brands.map((b) => [b.id, b]));
  const bImgs = byBrand(before.children.brand_images ?? []);
  const aImgs = byBrand(after.children.brand_images ?? []);

  // Pair on brand ID, not slug: the slug is one of the fields under comparison,
  // and pairing on a field that can change would silently drop any brand whose
  // slug moved — exactly the case most worth seeing.
  const pairs = cohort.slugs.flatMap((slug) => {
    const b = bBrand.get(slug);
    if (!b) return [];
    const a = aBrandById.get(b.id);
    return a ? [{ slug, before: b, after: a }] : [];
  });

  const totalBefore = pairs.reduce(
    (n, p) =>
      n +
      (bImgs.get(p.before.id) ?? []).filter((i) => i.status === "active")
        .length,
    0,
  );
  const totalAfter = pairs.reduce(
    (n, p) =>
      n +
      (aImgs.get(p.after.id) ?? []).filter((i) => i.status === "active").length,
    0,
  );

  const summary = pairs
    .map(({ slug, before: b, after: a }) => {
      const nb = (bImgs.get(b.id) ?? []).filter(
        (i) => i.status === "active",
      ).length;
      const na = (aImgs.get(a.id) ?? []).filter(
        (i) => i.status === "active",
      ).length;
      const total = (aImgs.get(a.id) ?? []).length;
      const delta = na - nb;
      const cls =
        na === 0 ? "bad" : delta > 0 ? "good" : delta < 0 ? "warn" : "";
      const catChanged = show(b.product_type) !== show(a.product_type);
      return `<tr>
      <td><a href="#${esc(slug)}"><b>${esc(cohort.labels[slug] ?? String(b.name))}</b></a></td>
      <td${catChanged ? ' class="changed"' : ""}>${esc(show(b.product_type) || "—")} → <b>${esc(show(a.product_type) || "—")}</b></td>
      <td class="num">${nb}</td>
      <td class="num">${total}</td>
      <td class="num ${cls}">${na}</td>
      <td class="num ${cls}">${delta > 0 ? `+${delta}` : delta}</td>
      <td class="num">${costs.get(slug) ? usd(costs.get(slug)!.total) : '<span class="muted">—</span>'}</td>
    </tr>`;
    })
    .join("");

  const sections = pairs
    .map(({ slug, before: b, after: a }) => {
      const beforeImgs = sortImgs(
        (bImgs.get(b.id) ?? []).filter((i) => i.status === "active"),
      );
      const afterAll = sortImgs(aImgs.get(a.id) ?? []);
      const afterPub = afterAll.filter((i) => i.status === "active");
      const afterRest = afterAll.filter((i) => i.status !== "active");

      return `<section class="brand" id="${esc(slug)}">
  <h2>${esc(cohort.labels[slug] ?? String(a.name))} <span class="slug">${esc(slug)}</span>
    <a class="live" href="https://formoria.com/brands/${esc(String(a.slug))}" target="_blank" rel="noreferrer">view live ↗</a></h2>

  <h3>Identity &amp; category</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — was live</th><th>After — now live</th></tr></thead><tbody>
    ${IDENTITY_FIELDS.map(([f, label]) => cmpRow(label, b[f], a[f])).join("")}
  </tbody></table></div>

  <h3>Links</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — was live</th><th>After — now live</th></tr></thead><tbody>
    ${LINK_FIELDS.map((f) => cmpRow(f, b[f], a[f])).join("")}
  </tbody></table></div>

  <h3>Generated content</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — was live</th><th>After — now live</th></tr></thead><tbody>
    ${CONTENT_FIELDS.map(([f, label]) => cmpRow(label, b[f], a[f])).join("")}
  </tbody></table></div>

  <h3>Cost <span class="meta">${costs.get(slug) ? `${usd(costs.get(slug)!.total)} across ${costs.get(slug)!.calls} LLM call(s)` : "no audit rows"}</span></h3>
  ${costTable(costs.get(slug))}

  <h3>Images <span class="meta">${beforeImgs.length} published → ${afterPub.length} published, from ${afterAll.length} candidates</span></h3>
  <div class="lbl">Before — what was published</div>
  <div class="grid">${beforeImgs.map((i) => tile(i, true)).join("") || '<p class="muted">None.</p>'}</div>
  <div class="lbl">After — what is published now</div>
  <div class="grid">${afterPub.map((i) => tile(i, true)).join("") || '<p class="muted">None.</p>'}</div>
  ${afterRest.length ? `<details><summary>${afterRest.length} candidate(s) not published — rejected or unclassified</summary><div class="grid">${afterRest.map((i) => tile(i, false)).join("")}</div></details>` : ""}
</section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formoria — ${esc(cohort.title)}</title>
<style>
:root{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}}
:root[data-theme="dark"]{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}
:root[data-theme="light"]{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Helvetica Neue","PingFang TC",sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:0 24px 90px}
header{border-bottom:1px solid var(--line);padding:40px 0 20px;margin-bottom:20px}
h1{margin:0 0 8px;font-size:30px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0;max-width:74ch}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:24px;z-index:5;display:flex;gap:14px;flex-wrap:wrap;font-size:13px}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--accent)}
h2{font-size:22px;margin:0 0 14px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:26px 0 8px}
.slug{font-size:13px;color:var(--muted);font-weight:400}
.live{font-size:12px;font-weight:400;color:var(--accent);text-decoration:none}
.meta{font-size:12px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400}
.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:12px 0 6px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:720px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}
td{width:42%;word-break:break-word}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
table.cmp th:first-child{width:16%;color:var(--muted);font-weight:500}
td.same{color:var(--muted)}
td.changed{background:color-mix(in oklab,var(--accent) 13%,transparent)}
td.gained{background:color-mix(in oklab,var(--good) 15%,transparent)}
td.lost{background:color-mix(in oklab,var(--bad) 13%,transparent)}
td.num{text-align:right;font-variant-numeric:tabular-nums;width:auto}
.good{color:var(--good);font-weight:700}.warn{color:var(--warn);font-weight:700}.bad{color:var(--bad);font-weight:700}
.muted{color:var(--muted)}
.brand{padding-top:30px;border-top:1px solid var(--line);margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:10px;margin-bottom:6px}
.tile{position:relative;margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.tile img{display:block;width:100%;height:142px;object-fit:cover;background:var(--line)}
.tile figcaption{padding:6px 8px;font-size:10px;color:var(--muted)}
.tile .l{display:flex;justify-content:space-between;gap:6px}
.tile .l span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .d,.tile .s{font-variant-numeric:tabular-nums;flex-shrink:0}
.tile .s{color:var(--ink);font-weight:700}
.tile .m{color:var(--accent)}
.tile b{display:inline-block;font-size:9px;background:var(--line);border-radius:99px;padding:0 6px;margin:3px 3px 0 0}
.tile .bad{margin-top:3px}
.tile .alt{margin-top:4px;line-height:1.4}
.tile.dropped{opacity:.5;border-color:var(--bad)}
.rank{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.66);color:#fff;font-size:9px;padding:1px 7px;border-radius:99px}
details{margin-top:8px}summary{cursor:pointer;font-size:13px;color:var(--muted)}
.callout{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--radius);padding:16px 20px;margin-bottom:22px;font-size:14px}
.callout.warn{border-left-color:var(--warn)}
.key{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:22px}
.key span{display:flex;align-items:center;gap:6px}
.sw{width:14px;height:14px;border-radius:3px;display:inline-block}
.hl{display:flex;gap:28px;flex-wrap:wrap;margin:0 0 22px}
.hl div{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 18px}
.hl b{display:block;font-size:26px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.hl span{font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
<header>
<h1>${esc(cohort.title)}</h1>
<p class="sub">${esc(cohort.subtitle)} <b>Before</b> is production as captured ${esc(before.capturedAt.replace("T", " ").slice(0, 16))} UTC, immediately prior to the refresh. <b>After</b> is production as it stands now, captured ${esc(after.capturedAt.replace("T", " ").slice(0, 16))} UTC. Both columns are live <code>brands</code> rows — this change is already applied.</p>
</header>
<nav><a href="#summary">Summary</a>${pairs.map((p) => `<a href="#${esc(p.slug)}">${esc((cohort.labels[p.slug] ?? String(p.before.name)).split(" ")[0])}</a>`).join("")}</nav>

<div class="hl">
  <div><b>${pairs.length}</b><span>brands refreshed</span></div>
  <div><b>${totalBefore} → ${totalAfter}</b><span>published images</span></div>
  <div><b>${pairs.filter((p) => show(p.before.product_type) !== show(p.after.product_type)).length}</b><span>category changes</span></div>
  <div><b>${pairs.filter((p) => p.before.slug !== p.after.slug).length}</b><span>slug changes</span></div>
  ${totalCalls ? `<div><b>${usd(grandTotal)}</b><span>LLM cost, ${totalCalls} calls${totalUnpriced ? ` · ${totalUnpriced} unpriced` : ""}</span></div>` : ""}
</div>

<div class="callout">
<b>This ran the real pipeline against production.</b> Each brand was snapshotted into a refresh submission via <code>request_brand_refresh</code>, enriched by a genuine curation job (<code>enqueueAdminCurationJob</code> → <code>runJob</code> → <code>runEnrich</code>, steps <b>context, image, detail</b>), then written back with <code>apply_brand_refresh</code> — the same three RPCs the admin UI uses. Nothing here was hand-written into the database.
</div>

${cohort.warning ? `<div class="callout warn">${esc(cohort.warning)}</div>` : ""}

<div class="key">
  <span><i class="sw" style="background:color-mix(in oklab,var(--good) 40%,transparent)"></i> newly filled</span>
  <span><i class="sw" style="background:color-mix(in oklab,var(--accent) 40%,transparent)"></i> changed</span>
  <span><i class="sw" style="background:color-mix(in oklab,var(--bad) 40%,transparent)"></i> lost</span>
  <span>unhighlighted = unchanged</span>
</div>

<h2 id="summary">Summary</h2>
<div class="scroll"><table>
<thead><tr><th>Brand</th><th>Category before → after</th><th class="num">Published before</th><th class="num">Candidates</th><th class="num">Published now</th><th class="num">Δ</th><th class="num">LLM cost</th></tr></thead>
<tbody>${summary}</tbody>
</table></div>

${sections}
</div></body></html>`;

  const out = artifactPath(cohort.name);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
  console.log(`wrote ${out}`);
  console.log(`  file://${out}`);
  console.log(
    `  ${pairs.length} brands, images ${totalBefore} -> ${totalAfter}`,
  );
}

void main();

export {};
