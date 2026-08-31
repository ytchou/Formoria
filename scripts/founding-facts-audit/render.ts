import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { artifactPath, esc } from "../shared/artifact";
import type {
  FoundingFactsAuditArtifact,
  FoundingFactsBrandAudit,
  FoundingFactsFieldAudit,
} from "./core";

function show(value: unknown): string {
  return value == null || value === "" ? "—" : String(value);
}

function fieldSection(
  brand: FoundingFactsBrandAudit,
  field: FoundingFactsFieldAudit,
): string {
  const evidence = field.proposal.evidence
    .map(
      (claim) => `<li>
        <a href="${esc(claim.citedUrl)}" target="_blank" rel="noreferrer">${esc(claim.citedUrl)}</a>
        <blockquote>${esc(claim.exactExcerpt)}</blockquote>
        <small>${esc(claim.sourceType)}${claim.sourceType === "independent" ? ` · ${claim.reputable ? "reputable" : "unrated"}` : ""} · verifier ${claim.verification.passed ? "passed" : `failed: ${esc(claim.verification.reason ?? "no reason")}`}</small>
      </li>`,
    )
    .join("");
  const key = `${brand.snapshot.id}.${field.field}`;
  const decision = field.requiresDecision
    ? `<label class="decision">Decision
        <select data-decision-key="${esc(key)}">
          <option value="">Choose…</option>
          ${field.proposal.value != null ? '<option value="accept-proposal">Accept proposal</option>' : ""}
          <option value="retain-current">Retain current</option>
          <option value="set-null">Set null</option>
        </select>
      </label>`
    : "";
  return `<section class="field ${esc(field.proposal.confidence)}">
    <h3>${esc(field.field)}</h3>
    <dl>
      <div><dt>Current</dt><dd>${esc(show(field.expectedCurrent))}</dd></div>
      <div><dt>Proposed</dt><dd>${esc(show(field.proposal.value))}</dd></div>
      <div><dt>Confidence</dt><dd>${esc(field.proposal.confidence)}</dd></div>
      <div><dt>Action</dt><dd>${esc(field.action)}</dd></div>
      <div><dt>Protection</dt><dd>${esc(field.protection ?? "writable")}</dd></div>
    </dl>
    ${field.humanOriginConflict ? '<p class="warning">Human-authored origin copy depends on a conflicting audited fact.</p>' : ""}
    ${field.proposal.conflicts.length > 0 ? `<p class="warning">Conflicts: ${esc(field.proposal.conflicts.map(show).join(", "))}</p>` : ""}
    ${field.proposal.rejections.length > 0 ? `<p class="muted">Rejected evidence: ${esc(field.proposal.rejections.join(", "))}</p>` : ""}
    ${evidence ? `<ol class="evidence">${evidence}</ol>` : '<p class="muted">No accepted evidence.</p>'}
    ${decision}
  </section>`;
}

function brandSection(brand: FoundingFactsBrandAudit): string {
  const failures = brand.sources
    .filter((source) => source.error != null)
    .map(
      (source) =>
        `<li><a href="${esc(source.url)}">${esc(source.url)}</a> — ${esc(source.error ?? "failed")}</li>`,
    )
    .join("");
  const sources = brand.sources
    .map(
      (source) =>
        `<li><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.url)}</a> <small>${esc(source.sourceType)} · ${esc(source.discoveredBy)} · ${source.fetched ? "fetched" : "snippet/unfetched"}</small></li>`,
    )
    .join("");
  return `<article class="brand">
    <header><h2>${esc(brand.snapshot.name)}</h2><code>${esc(brand.snapshot.slug)}</code></header>
    <div class="fields">
      ${fieldSection(brand, brand.fields.city)}
      ${fieldSection(brand, brand.fields.founding_year)}
    </div>
    <details><summary>Sources (${brand.sources.length})</summary><ul>${sources || "<li>None</li>"}</ul></details>
    ${failures ? `<details class="failures"><summary>Fetch failures</summary><ul>${failures}</ul></details>` : ""}
  </article>`;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

export function renderAuditHtml(artifact: FoundingFactsAuditArtifact): string {
  const reviewFields = artifact.brands.flatMap((brand) =>
    (["city", "founding_year"] as const).flatMap((field) => {
      const audited = brand.fields[field];
      return audited.requiresDecision
        ? [
            {
              key: `${brand.snapshot.id}.${field}`,
              brandId: brand.snapshot.id,
              field,
              expectedCurrent: audited.expectedCurrent,
              evidenceHash: audited.proposal.evidenceHash,
            },
          ]
        : [];
    }),
  );
  const metrics = artifact.metrics;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Founding facts audit ${esc(artifact.runId)}</title>
<style>
:root{color-scheme:light dark;--bg:#f5f2ea;--card:#fff;--ink:#25231f;--muted:#6f6a60;--line:#d7d0c3;--high:#276749;--medium:#9c6500;--bad:#b42318}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px 20px 80px}h1,h2,h3{line-height:1.2}.summary,.brand{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:18px 0}.metrics,.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.metrics{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.metric{padding:12px;background:color-mix(in srgb,var(--card),var(--line) 18%);border-radius:9px}.metric strong{display:block;font-size:1.35rem}.brand header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.field{border:1px solid var(--line);border-top:5px solid var(--line);border-radius:10px;padding:16px}.field.high{border-top-color:var(--high)}.field.medium{border-top-color:var(--medium)}dl{margin:0}dl div{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:5px 0}dt{color:var(--muted)}dd{margin:0;font-weight:650}.evidence{padding-left:22px}.evidence li{margin:12px 0}blockquote{margin:6px 0;padding-left:10px;border-left:3px solid var(--line)}a{color:inherit;overflow-wrap:anywhere}.warning{color:var(--bad);font-weight:650}.muted,small{color:var(--muted)}.decision{display:grid;gap:6px;margin-top:14px;font-weight:700}select,button{font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}button{cursor:pointer;font-weight:700}.toolbar{position:sticky;bottom:14px;display:flex;justify-content:flex-end}.toolbar button{box-shadow:0 6px 24px #0003}@media(max-width:760px){.fields{grid-template-columns:1fr}}
@media(prefers-color-scheme:dark){:root{--bg:#181714;--card:#24221e;--ink:#f4efe5;--muted:#b7afa2;--line:#4c473f}}
</style></head><body><main>
<h1>Founding facts audit</h1><p>Run <code>${esc(artifact.runId)}</code> · ${esc(artifact.mode)} · ${esc(artifact.createdAt)}</p>
<section class="summary"><div class="metrics">
<div class="metric"><strong>${metrics.approvedCount}</strong>approved audited</div>
<div class="metric"><strong>${metrics.cityPopulatedBefore}</strong>city populated before</div>
<div class="metric"><strong>${metrics.foundingYearPopulatedBefore}</strong>year populated before</div>
<div class="metric"><strong>${metrics.fetchFailures}</strong>fetch failures</div>
<div class="metric"><strong>${metrics.searchFailures}</strong>search failures</div>
<div class="metric"><strong>${metrics.serperCredits}</strong>Serper credits</div>
<div class="metric"><strong>${metrics.llmCalls}</strong>Luna calls</div>
<div class="metric"><strong>${metrics.llmCostUsd == null ? "unpriced" : `$${metrics.llmCostUsd.toFixed(4)}`}</strong>Luna spend</div>
</div></section>
${artifact.brands.map(brandSection).join("\n")}
<div class="toolbar"><button id="download" type="button">Download decisions JSON</button></div>
<script id="review-fields" type="application/json">${scriptJson(reviewFields)}</script>
<script>
const runId=${scriptJson(artifact.runId)};const key='formoria-founding-facts:'+runId;
const fields=JSON.parse(document.getElementById('review-fields').textContent);let saved={};
try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{saved={}}
for(const select of document.querySelectorAll('[data-decision-key]')){const fieldKey=select.dataset.decisionKey;select.value=saved[fieldKey]||'';select.addEventListener('change',()=>{saved[fieldKey]=select.value;localStorage.setItem(key,JSON.stringify(saved))})}
document.getElementById('download').addEventListener('click',()=>{const missing=fields.filter(field=>!saved[field.key]);if(missing.length){alert('Choose a decision for every review field first. Missing: '+missing.length);return}const bundle={version:1,runId,exportedAt:new Date().toISOString(),decisions:fields.map(field=>({brandId:field.brandId,field:field.field,decision:saved[field.key],expectedCurrent:field.expectedCurrent,evidenceHash:field.evidenceHash}))};const blob=new Blob([JSON.stringify(bundle,null,2)+'\\n'],{type:'application/json'});const href=URL.createObjectURL(blob);const link=document.createElement('a');link.href=href;link.download='founding-facts-decisions-'+runId+'.json';link.click();URL.revokeObjectURL(href)});
</script></main></body></html>`;
}

export async function renderAudit(artifactFile: string): Promise<string> {
  const artifact = JSON.parse(
    await readFile(artifactFile, "utf8"),
  ) as FoundingFactsAuditArtifact;
  if (
    artifact.version !== 1 ||
    !artifact.runId ||
    !Array.isArray(artifact.brands)
  )
    throw new Error("invalid founding-facts audit artifact");
  const output = artifactPath("founding-facts", {
    prefix: "review",
    ext: "html",
    suffix: process.pid,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderAuditHtml(artifact), "utf8");
  return output;
}
