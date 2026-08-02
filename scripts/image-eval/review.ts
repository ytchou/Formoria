import { createServer } from "node:http";
import { URL } from "node:url";
import { createImageEvalSignedUrls } from "@/lib/services/image-eval-storage";
import {
  LABELS_PATH,
  MANIFEST_PATH,
  runPath,
  ensureEvalDirectories,
  readJson,
  writeJsonAtomic,
} from "./lib/paths";
import {
  appendLabelRevision,
  defaultTagDefinitions,
  hydrateLabelsFile,
  normalizeLabelInput,
  REJECTION_REASON_DEFINITIONS,
  registerTagDefinition,
  validateLabel,
} from "./lib/labels";
import {
  EVAL_SCHEMA_VERSION,
  type GoldenLabelsFile,
  type GoldenManifest,
  type EvalPrediction,
  type KeptTag,
  type RejectionReason,
} from "./lib/types";
import {
  REVIEW_HOLDOUT_COUNT,
  REVIEW_QUEUE_SEED,
  reviewQueue,
} from "./lib/review";

const DEFAULT_PORT = 4179;
const DEFAULT_APP_ORIGIN = "http://localhost:3000";

type DraftPredictionsFile = {
  corpusId: string;
  scope?: string;
  reviewQueueSeed?: string;
  predictions: EvalPrediction[];
  prompt?: string;
};

type LoadedDraft = {
  runId: string | null;
  prompt: string | null;
  predictions: Record<string, EvalPrediction>;
};

const REVIEW_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DEV-1279 image review</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #171717; color: #f5f5f5; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 100vh; }
    .stage { display: grid; place-items: center; padding: 24px; background: #0c0c0c; }
    .stage img { max-width: min(100%, 1000px); max-height: calc(100vh - 48px); object-fit: contain; }
    aside { padding: 24px; overflow: auto; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    #counter, #meta { color: #a3a3a3; font-size: 13px; line-height: 1.5; }
    .group { margin-top: 20px; }
    .group h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #a3a3a3; }
    button, label { display: block; width: 100%; box-sizing: border-box; margin: 8px 0; padding: 11px 12px; border: 1px solid #404040; border-radius: 8px; background: #262626; color: inherit; text-align: left; cursor: pointer; }
    button:hover, label:hover { background: #333; }
    button.active { border-color: #f5f5f5; background: #404040; }
    input[type=checkbox] { margin-right: 8px; }
    input[type=text] { width: 100%; box-sizing: border-box; margin: 8px 0; padding: 10px 12px; border: 1px solid #404040; border-radius: 8px; background: #262626; color: inherit; }
    #add-tag-form button { text-align: center; }
    .brand-link { display: block; box-sizing: border-box; margin-top: 8px; padding: 11px 12px; border: 1px solid #6a9f82; border-radius: 8px; color: #9bd5b0; text-align: center; text-decoration: none; }
    .brand-link:hover { background: #263c30; }
    textarea { width: 100%; min-height: 70px; box-sizing: border-box; background: #262626; color: inherit; border: 1px solid #404040; border-radius: 8px; padding: 8px; }
    #save { background: #f5f5f5; color: #171717; text-align: center; font-weight: 700; }
    .keys { color: #a3a3a3; font-size: 12px; line-height: 1.6; }
  </style>
</head>
<body>
<main>
  <section class="stage"><img id="image" alt="Golden dataset image"></section>
  <aside>
    <h1>DEV-1279 image review</h1>
    <div id="counter"></div><div id="meta"></div><div id="history"></div>
    <a id="brand-link" class="brand-link" target="_blank" rel="noopener noreferrer" hidden>Open local brand page</a>
    <p class="keys">Queue: 400 images, randomized within split. All dev images come before the 50-image holdout sample.</p>
    <div class="group"><h2>AI draft</h2>
      <div id="draft" class="keys">No AI draft loaded.</div>
      <button id="save">Save label and next</button>
    </div>
    <div class="group"><h2>Disposition</h2>
      <button data-disposition="keep">Keep — useful and publishable</button>
      <button data-disposition="reject">Reject — worse than no image</button>
    </div>
    <div id="tag-group" class="group" hidden><h2>Primary tag</h2>
      <div id="tag-options"></div>
      <form id="add-tag-form">
        <input id="new-tag-slug" type="text" required placeholder="Slug, e.g. workspace">
        <input id="new-tag-label" type="text" required placeholder="Display name">
        <input id="new-tag-description" type="text" required placeholder="Definition for the model">
        <button type="submit">Add primary tag</button>
      </form>
      <div id="tag-status" class="keys"></div>
    </div>
    <div id="reason-group" class="group" hidden><h2>Rejection reasons</h2>
      <div id="reason-options"></div>
    </div>
    <div class="group"><h2>Notes</h2><textarea id="notes" placeholder="Optional adjudication note"></textarea></div>
    <p class="keys">Keys: K keep, R reject, 1–9 tag, ←/→ navigate. Reject defaults to low visual quality until you choose a reason.</p>
  </aside>
</main>
<script>
let entries = [], labels = {}, labelHistory = {}, drafts = {}, draftRunId = null, draftPrompt = null, tagDefinitions = {}, rejectionReasons = [], brandPageOrigin = 'http://localhost:3000', index = 0, state = { disposition: null, tag: null, reasons: [], notes: '' };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function current() { return entries[index]; }
function renderTagOptions() {
  const definitions = Object.values(tagDefinitions);
  $('#tag-options').innerHTML = definitions.map((definition, definitionIndex) => '<button data-tag="' + esc(definition.slug) + '" title="' + esc(definition.description) + '">' + (definitionIndex < 9 ? (definitionIndex + 1) + ' · ' : '') + esc(definition.label) + '</button>').join('');
}
function renderReasonOptions() {
  $('#reason-options').innerHTML = rejectionReasons.map((reason) => '<label><input type="checkbox" data-reason value="' + esc(reason.slug) + '">' + esc(reason.label) + '</label>').join('');
}
function renderDraft() {
  const suggestion = drafts[current().id];
  if (!suggestion) { $('#draft').textContent = draftRunId ? 'No suggestion for this image.' : 'No AI draft loaded.'; return; }
  if (suggestion.error) { $('#draft').textContent = 'AI draft unresolved: ' + suggestion.error; return; }
  const tag = suggestion.tag ? (tagDefinitions[suggestion.tag]?.label || suggestion.tag) : 'no primary tag';
  const reasons = suggestion.reasons?.length ? ' · ' + suggestion.reasons.join(', ') : '';
  const score = typeof suggestion.score === 'number' ? ' · score ' + suggestion.score : '';
  $('#draft').textContent = (draftRunId ? 'run ' + draftRunId + ' · ' : '') + (draftPrompt ? draftPrompt + ' · ' : '') + suggestion.disposition.toUpperCase() + ' · ' + tag + score + reasons + ' · not saved';
}
function render(reset = true) {
  const entry = current(); if (!entry) return;
  $('#image').src = entry.signedUrl || ''; $('#image').alt = entry.brandName + ' ' + entry.category + ' image';
  const brandLink = $('#brand-link');
  if (entry.brandSlug) { brandLink.href = brandPageOrigin + '/brands/' + encodeURIComponent(entry.brandSlug); brandLink.hidden = false; } else { brandLink.hidden = true; }
  const existing = labels[entry.id];
  const suggestion = drafts[entry.id];
  if (reset) state = existing ? { disposition: existing.disposition, tag: existing.tag, reasons: existing.reasons || [], notes: existing.notes || '' } : suggestion && !suggestion.error && (suggestion.disposition === 'keep' || suggestion.disposition === 'reject') ? { disposition: suggestion.disposition, tag: suggestion.disposition === 'keep' ? suggestion.tag : null, reasons: suggestion.disposition === 'reject' ? (suggestion.reasons || []) : [], notes: '' } : { disposition: null, tag: null, reasons: [], notes: '' };
  renderTagOptions();
  renderReasonOptions();
  $('#tag-group').hidden = state.disposition !== 'keep';
  $('#reason-group').hidden = state.disposition !== 'reject';
  renderDraft();
  $('#counter').textContent = (index + 1) + ' / ' + entries.length + (existing ? ' · labeled' : ' · unlabeled');
  $('#meta').textContent = entry.brandName + ' · ' + entry.category;
  const revisions = labelHistory[entry.id] || [];
  $('#history').textContent = revisions.length + ' saved revision' + (revisions.length === 1 ? '' : 's');
  document.querySelectorAll('[data-disposition]').forEach((button) => button.classList.toggle('active', button.dataset.disposition === state.disposition));
  document.querySelectorAll('[data-tag]').forEach((button) => button.classList.toggle('active', button.dataset.tag === state.tag));
  document.querySelectorAll('[data-reason]').forEach((input) => input.checked = state.reasons.includes(input.value));
  $('#notes').value = state.notes;
}
function setDisposition(disposition) { state.disposition = disposition; if (disposition === 'keep') state.reasons = []; if (disposition === 'reject') { state.tag = null; if (!state.reasons.length) state.reasons = ['low_visual_quality']; } render(false); }
function setTag(tag) { state.disposition = 'keep'; state.tag = tag; state.reasons = []; render(false); }
async function save() {
  if (!state.disposition) return alert('Choose keep or reject first.');
  if (state.disposition === 'keep' && !state.tag) return alert('Choose one primary tag before saving a kept image.');
  const reasons = [...document.querySelectorAll('[data-reason]:checked')].map((input) => input.value);
  const payload = { imageId: current().id, disposition: state.disposition, tag: state.disposition === 'keep' ? state.tag : null, reasons, notes: $('#notes').value };
  const response = await fetch('/api/labels', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
  if (!response.ok) return alert(await response.text());
  const saved = await response.json();
  labels[current().id] = saved.label;
  labelHistory[current().id] = saved.history || [];
  if (index < entries.length - 1) index += 1;
  render();
}
document.querySelectorAll('[data-disposition]').forEach((button) => button.addEventListener('click', () => setDisposition(button.dataset.disposition)));
$('#tag-options').addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-tag]') : null; if (button) setTag(button.dataset.tag); });
$('#reason-options').addEventListener('change', (event) => { const input = event.target instanceof HTMLInputElement && event.target.matches('[data-reason]') ? event.target : null; if (input) state.reasons = [...document.querySelectorAll('[data-reason]:checked')].map((item) => item.value); });
$('#add-tag-form').addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/tags', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ slug: $('#new-tag-slug').value, label: $('#new-tag-label').value, description: $('#new-tag-description').value, imageId: current().id }) }); if (!response.ok) return alert(await response.text()); const saved = await response.json(); tagDefinitions = saved.tagDefinitions; $('#new-tag-slug').value = ''; $('#new-tag-label').value = ''; $('#new-tag-description').value = ''; $('#tag-status').textContent = 'Added ' + saved.tag.label + '; selected for this image.'; setTag(saved.tag.slug); });
$('#save').addEventListener('click', save);
document.addEventListener('keydown', (event) => { if (event.target.matches('textarea,input')) return; if (event.key.toLowerCase() === 'k') setDisposition('keep'); if (event.key.toLowerCase() === 'r') setDisposition('reject'); if (/^[1-9]$/.test(event.key)) { const option = Object.values(tagDefinitions)[Number(event.key) - 1]; if (option) setTag(option.slug); } if (event.key === 'ArrowLeft' && index > 0) { index -= 1; render(); } if (event.key === 'ArrowRight' && index < entries.length - 1) { index += 1; render(); } if (event.key === 'Enter') save(); });
fetch('/api/corpus').then((response) => response.json()).then((payload) => { entries = payload.entries; labels = payload.labels; labelHistory = payload.history || {}; drafts = payload.drafts || {}; draftRunId = payload.draftRunId || null; draftPrompt = payload.draftPrompt || null; tagDefinitions = payload.tagDefinitions || {}; rejectionReasons = payload.rejectionReasons || []; brandPageOrigin = payload.brandPageOrigin || 'http://localhost:3000'; const firstUnlabeled = entries.findIndex((entry) => !labels[entry.id]); index = firstUnlabeled >= 0 ? firstUnlabeled : 0; render(); });
</script>
</body></html>`;

async function loadLabels(manifest: GoldenManifest): Promise<GoldenLabelsFile> {
  try {
    const labels = await readJson<GoldenLabelsFile>(LABELS_PATH);
    if (labels.corpusId !== manifest.corpusId)
      throw new Error("labels corpusId does not match manifest");
    return hydrateLabelsFile(labels);
  } catch {
    return {
      schemaVersion: EVAL_SCHEMA_VERSION,
      corpusId: manifest.corpusId,
      labels: {},
      history: {},
      tagDefinitions: defaultTagDefinitions(),
    };
  }
}

function draftRunArg(): string | null {
  const argument = process.argv.find((value) =>
    value.startsWith("--draft-run="),
  );
  const value = argument?.slice("--draft-run=".length).trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("--draft-run must be a safe run id");
  return value;
}

function appOriginArg(): string {
  const argument = process.argv.find((value) =>
    value.startsWith("--app-origin="),
  );
  const value =
    argument?.slice("--app-origin=".length).trim() || DEFAULT_APP_ORIGIN;
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("--app-origin must be a valid URL");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("--app-origin must point to localhost or 127.0.0.1");
  return origin.origin;
}

async function loadDraft(
  manifest: GoldenManifest,
  entries: GoldenManifest["entries"],
  runId: string | null,
): Promise<LoadedDraft> {
  if (!runId) return { runId: null, prompt: null, predictions: {} };

  const file = await readJson<DraftPredictionsFile>(
    runPath(runId, "predictions.json"),
  );
  if (file.corpusId !== manifest.corpusId)
    throw new Error("draft corpusId does not match manifest");
  if (file.scope !== "review")
    throw new Error("draft scope must be review for the reviewer queue");
  if (file.reviewQueueSeed !== REVIEW_QUEUE_SEED)
    throw new Error(
      "draft review queue seed does not match the reviewer queue",
    );
  if (!Array.isArray(file.predictions))
    throw new Error("draft predictions must be an array");

  const allowedIds = new Set(entries.map((entry) => entry.id));
  const predictions = Object.fromEntries(
    file.predictions
      .filter(
        (prediction) =>
          prediction &&
          typeof prediction.imageId === "string" &&
          allowedIds.has(prediction.imageId),
      )
      .map((prediction) => [prediction.imageId, prediction]),
  );
  return { runId, prompt: file.prompt ?? null, predictions };
}

async function readBody(
  request: import("node:http").IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 100_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function json(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function startReview(): Promise<void> {
  await ensureEvalDirectories();
  const manifest = await readJson<GoldenManifest>(MANIFEST_PATH);
  const labelsFile = await loadLabels(manifest);
  const entries = reviewQueue(manifest.entries, REVIEW_HOLDOUT_COUNT);
  const draft = await loadDraft(manifest, entries, draftRunArg());
  const portArg = process.argv.find((argument) =>
    argument.startsWith("--port="),
  );
  const port = portArg ? Number(portArg.slice("--port=".length)) : DEFAULT_PORT;
  const appOrigin = appOriginArg();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`,
      );
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(REVIEW_HTML);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/corpus") {
        const signedUrls = await createImageEvalSignedUrls(
          entries.flatMap((entry) =>
            entry.objectPath ? [entry.objectPath] : [],
          ),
        );
        json(response, 200, {
          corpusId: manifest.corpusId,
          reviewQueueSeed: REVIEW_QUEUE_SEED,
          reviewQueueSize: entries.length,
          entries: entries.map((entry) => ({
            ...entry,
            signedUrl: entry.objectPath
              ? (signedUrls.get(entry.objectPath) ?? null)
              : null,
          })),
          labels: labelsFile.labels,
          history: labelsFile.history ?? {},
          tagDefinitions: labelsFile.tagDefinitions ?? {},
          rejectionReasons: REJECTION_REASON_DEFINITIONS,
          brandPageOrigin: appOrigin,
          draftRunId: draft.runId,
          draftPrompt: draft.prompt,
          drafts: draft.predictions,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/tags") {
        const input = await readBody(request);
        if (!input || typeof input !== "object")
          return json(response, 400, { error: "invalid tag payload" });
        const value = input as {
          slug?: unknown;
          label?: unknown;
          description?: unknown;
          imageId?: unknown;
        };
        const registered = registerTagDefinition(labelsFile, {
          slug: typeof value.slug === "string" ? value.slug : "",
          label: typeof value.label === "string" ? value.label : "",
          description:
            typeof value.description === "string" ? value.description : "",
          createdFromImageId:
            typeof value.imageId === "string" ? value.imageId : null,
        });
        labelsFile.tagDefinitions = registered.labelsFile.tagDefinitions;
        await writeJsonAtomic(LABELS_PATH, labelsFile);
        json(response, 200, {
          tag: registered.tag,
          tagDefinitions: labelsFile.tagDefinitions ?? {},
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/labels") {
        const input = await readBody(request);
        if (!input || typeof input !== "object")
          return json(response, 400, { error: "invalid label payload" });
        const value = input as {
          imageId?: unknown;
          disposition?: unknown;
          tag?: unknown;
          reasons?: unknown;
          notes?: unknown;
        };
        const entry = entries.find(
          (candidate) => candidate.id === value.imageId,
        );
        if (!entry)
          return json(response, 404, {
            error: "image is not in the ready manifest",
          });
        const label = normalizeLabelInput({
          imageId: entry.id,
          disposition: value.disposition === "keep" ? "keep" : "reject",
          tag: typeof value.tag === "string" ? (value.tag as KeptTag) : null,
          reasons: Array.isArray(value.reasons)
            ? value.reasons.filter(
                (reason): reason is RejectionReason =>
                  typeof reason === "string",
              )
            : [],
          notes: typeof value.notes === "string" ? value.notes : null,
        });
        const errors = validateLabel(label, labelsFile.tagDefinitions);
        if (errors.length > 0)
          return json(response, 400, { error: errors.join("; ") });
        const updatedLabelsFile = appendLabelRevision(labelsFile, label);
        labelsFile.labels = updatedLabelsFile.labels;
        labelsFile.history = updatedLabelsFile.history;
        await writeJsonAtomic(LABELS_PATH, labelsFile);
        json(response, 200, {
          label,
          history: labelsFile.history?.[label.imageId] ?? [],
        });
        return;
      }
      response.writeHead(404);
      response.end("not found");
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Image review server: http://127.0.0.1:${port}`);
    console.log(
      `Corpus: ${manifest.corpusId}; ${entries.length} downloadable images`,
    );
    console.log(`Brand app: ${appOrigin}`);
    console.log(`Draft: ${draft.runId ?? "none"}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startReview().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
