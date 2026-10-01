// Renders the local review sheet the founder picks trail products from (D7).
// Pure: candidates in, one self-contained HTML string out. Nothing here is
// published; the sheet is opened from disk and exports `picks.json`.

import {
  NOTE_MAX_CHARS,
  type ShortlistCandidate,
  type ShortlistCandidates,
  type ShortlistSection,
} from "./lib";

/** Fewer distinct brands than this means the section cannot reach 3 picks. */
const MIN_SECTION_BRANDS = 3;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only http(s) URLs reach an attribute; anything else (javascript:, data:) is dropped. */
function safeUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function renderCandidate(candidate: ShortlistCandidate): string {
  const image = safeUrl(candidate.imageUrl);
  const official = safeUrl(candidate.officialUrl);
  const note = candidate.note ?? "";

  return `<li class="card" data-brand="${escapeHtml(candidate.brandSlug)}" data-product-key="${escapeHtml(candidate.productKey)}">
  <div class="thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}</div>
  <h3>${escapeHtml(candidate.name)}</h3>
  <p class="meta">${escapeHtml(candidate.brandName)} · ${escapeHtml(candidate.subcategory)} · #${candidate.rank}</p>
  <p class="meta">${escapeHtml(candidate.brandSlug)}/${escapeHtml(candidate.productKey)}</p>
  ${official ? `<a href="${escapeHtml(official)}" target="_blank" rel="noopener noreferrer">官方頁面</a>` : `<p class="meta">沒有官方連結</p>`}
  <label class="pick-label"><input type="checkbox" class="pick"> 選取</label>
  <label class="note-label">短評 <input type="text" class="note" value="${escapeHtml(note)}"></label>
  <span class="count">0/${NOTE_MAX_CHARS}</span>
</li>`;
}

function renderSection(section: ShortlistSection): string {
  const brands = new Set(section.candidates.map((candidate) => candidate.brandSlug));
  const warning =
    brands.size < MIN_SECTION_BRANDS
      ? `<p class="warn">只有 ${brands.size} 個品牌，這一區湊不到 3 個選品。請重新規劃這一區，不要硬湊。</p>`
      : "";

  return `<section data-section="${escapeHtml(section.key)}">
  <h2>${escapeHtml(section.title)} <small>${escapeHtml(section.key)}</small></h2>
  <p class="meta">查詢：${escapeHtml(section.query)} · 子分類：${escapeHtml(section.subcategories.join(", "))}</p>
  ${warning}
  ${
    section.candidates.length === 0
      ? `<p class="warn">沒有符合條件的候選商品。</p>`
      : `<ol class="grid">\n${section.candidates.map(renderCandidate).join("\n")}\n</ol>`
  }
</section>`;
}

// Inline browser script. It reads everything from data attributes, so no
// candidate text is ever embedded inside <script>. The export builds the same
// object as `toPicksJson` in lib.ts; keep the two in step.
const SHEET_SCRIPT = `
(function () {
  var MAX_NOTE = ${NOTE_MAX_CHARS};
  var status = document.getElementById("status");

  function say(message) { status.textContent = message; }

  function noteLength(value) { return [...value.trim()].length; }

  function sameBrandPickedInSection(section, brand, except) {
    var boxes = section.querySelectorAll("input.pick");
    for (var i = 0; i < boxes.length; i += 1) {
      var box = boxes[i];
      if (box !== except && box.checked && box.closest(".card").dataset.brand === brand) {
        return true;
      }
    }
    return false;
  }

  function updateCount(input) {
    var card = input.closest(".card");
    var count = card.querySelector(".count");
    var length = noteLength(input.value);
    count.textContent = length + "/" + MAX_NOTE;
    card.classList.toggle("over", length > MAX_NOTE);
  }

  document.querySelectorAll("input.pick").forEach(function (box) {
    box.addEventListener("change", function () {
      var card = box.closest(".card");
      if (box.checked) {
        var section = box.closest("section");
        if (sameBrandPickedInSection(section, card.dataset.brand, box)) {
          box.checked = false;
          say("同一區已經選了 " + card.dataset.brand + " 的商品；一區每個品牌只能選一件。");
          return;
        }
      }
      card.classList.toggle("picked", box.checked);
    });
  });

  document.querySelectorAll("input.note").forEach(function (input) {
    updateCount(input);
    input.addEventListener("input", function () { updateCount(input); });
  });

  document.getElementById("export").addEventListener("click", function () {
    var trail = document.body.dataset.trail;
    var sections = {};
    var problems = [];
    document.querySelectorAll("section[data-section]").forEach(function (section) {
      var key = section.dataset.section;
      section.querySelectorAll(".card").forEach(function (card) {
        if (!card.querySelector("input.pick").checked) return;
        var note = card.querySelector("input.note").value.trim();
        var label = key + " / " + card.dataset.brand + "/" + card.dataset.productKey;
        if (note === "") problems.push(label + "：短評是空的");
        else if (noteLength(note) > MAX_NOTE) problems.push(label + "：短評超過 " + MAX_NOTE + " 字");
        (sections[key] = sections[key] || []).push({
          brandSlug: card.dataset.brand,
          productKey: card.dataset.productKey,
          note: note,
        });
      });
    });
    if (problems.length > 0) {
      say("無法匯出：" + problems.join("；"));
      return;
    }
    var blob = new Blob([JSON.stringify({ trail: trail, sections: sections }, null, 2) + "\\n"], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "picks.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking synchronously can cancel the download before the browser
    // reads the blob; defer it past the click's navigation.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    say("已匯出 picks.json。");
  });
})();
`;

const SHEET_STYLE = `
body { margin: 0; padding: 32px 24px 96px; background: #FAF7F2; color: #1A1815; font-family: system-ui, "PingFang TC", "Noto Sans TC", sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 32px; }
h1 { margin: 0; font-size: 1.5rem; }
h2 { margin: 0 0 8px; font-size: 1.25rem; }
h2 small, .meta { color: #6F685F; font-size: 0.875rem; font-weight: normal; }
h3 { margin: 8px 0 4px; font-size: 1rem; }
section { margin-top: 64px; border-top: 1px solid #DED5C8; padding-top: 24px; }
.grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 24px; }
.card { background: #F1EAE0; border: 2px solid transparent; border-radius: 3px; padding: 12px; }
.card.picked { border-color: #2F4F63; }
.card.over .count { color: #A3341F; font-weight: bold; }
.thumb { aspect-ratio: 1 / 1; background: #e8dfd2; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
label { display: flex; gap: 8px; align-items: center; min-height: 44px; }
input.note { flex: 1; min-height: 36px; font: inherit; }
.warn { color: #A3341F; }
button { min-height: 44px; padding: 0 20px; font: inherit; background: #2F4F63; color: #FAF7F2; border: 0; border-radius: 4px; cursor: pointer; }
a:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid #2F4F63; outline-offset: 2px; }
#status { min-height: 1.5em; }
`;

/**
 * Self-contained review sheet: one card per candidate with a checkbox, a note
 * input with a live 20-character counter, a same-brand-in-section block, and an
 * Export button that downloads `picks.json`.
 */
export function renderReviewSheet(candidates: ShortlistCandidates): string {
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(candidates.trail)} — 選品審閱</title>
<style>${SHEET_STYLE}</style>
</head>
<body data-trail="${escapeHtml(candidates.trail)}">
<header>
  <div>
    <h1>${escapeHtml(candidates.trail)} 選品審閱</h1>
    <p class="meta">${escapeHtml(candidates.target)} (${escapeHtml(candidates.projectRef)}) · ${escapeHtml(candidates.generatedAt)} · 每區每個品牌限選一件，短評 ${NOTE_MAX_CHARS} 字以內</p>
  </div>
  <button type="button" id="export">匯出 picks.json</button>
</header>
<p id="status" role="status"></p>
${candidates.sections.map(renderSection).join("\n")}
<script>${SHEET_SCRIPT}</script>
</body>
</html>
`;
}
