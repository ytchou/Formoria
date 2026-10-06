import type { Browser } from "@playwright/test";
import { stripMarkers } from "./trail-prose";
import type { Run } from "./types";

export type PreviewDeps = { launch?: () => Promise<Browser> };

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character]!);
}
function paragraphs(text: string): string {
  return stripMarkers(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => "<p>" + escapeHtml(paragraph) + "</p>")
    .join("\n");
}
function label(name: string, text: string): string {
  return stripMarkers(text)
    ? '<p class="label"><span>' +
        name +
        "</span> " +
        escapeHtml(stripMarkers(text)) +
        "</p>"
    : "";
}

const STYLE =
  "body{margin:0;background:#faf8f4;color:#1f1f1f;" +
  'font-family:"Noto Sans CJK TC","Noto Sans TC","WenQuanYi Zen Hei","PingFang TC",sans-serif;' +
  "font-size:17px;line-height:1.8}" +
  "main{box-sizing:border-box;width:760px;padding:48px 56px}" +
  "h1{font-size:30px;line-height:1.4;margin:0 0 12px}" +
  "h2{font-size:22px;line-height:1.4;margin:40px 0 8px}" +
  ".description{font-size:19px;color:#3d3d3d}" +
  ".label{font-size:14px;color:#5c5c5c;margin:4px 0}" +
  ".label span{font-weight:600;margin-right:4px}" +
  "ul{list-style:none;padding:0;margin:16px 0}" +
  "li{border-left:3px solid #c9b99a;padding:4px 0 4px 14px;margin:10px 0}" +
  "li .brand{color:#5c5c5c;font-size:15px}" +
  "li .note{display:block;font-size:15px}";

/**
 * The draft as a plain self-contained document for the review screenshot. It
 * is not the site's trail page: no site CSS, components or images.
 */
export function previewHtml(run: Run): string {
  const trail = run.trail;
  if (!trail) throw new Error("Run has no trail draft");
  const sections = trail.sections.map((section) => {
    const products = section.picks.map((pick) => {
      const product = run.catalog?.find((item) => item.id === pick.productId);
      return (
        "<li><strong>" +
        escapeHtml(product?.nameZh ?? pick.productId) +
        '</strong> <span class="brand">' +
        escapeHtml(product?.brandName ?? "") +
        '</span><span class="note">' +
        escapeHtml(stripMarkers(pick.note)) +
        "</span></li>"
      );
    });
    return (
      "<section><h2>" +
      escapeHtml(stripMarkers(section.title)) +
      "</h2>\n" +
      paragraphs(section.body) +
      (products.length ? "\n<ul>" + products.join("") + "</ul>" : "") +
      "</section>"
    );
  });
  return [
    '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><style>' +
      STYLE +
      "</style></head><body><main>",
    "<h1>" + escapeHtml(stripMarkers(trail.title)) + "</h1>",
    '<p class="description">' +
      escapeHtml(stripMarkers(trail.description)) +
      "</p>",
    label("Reader situation", trail.readerSituation),
    label("Promise", trail.promise),
    paragraphs(trail.intro),
    ...sections,
    paragraphs(trail.closing),
    label("Exclusions", trail.exclusions),
    "</main></body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Full-page PNG of the preview document in headless Chromium. */
export async function renderPreview(
  html: string,
  deps: PreviewDeps = {},
): Promise<Uint8Array> {
  const launch =
    deps.launch ??
    (async () => {
      const { chromium } = await import("@playwright/test");
      return chromium.launch({ headless: true });
    });
  const browser = await launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 760, height: 1000 },
      deviceScaleFactor: 2,
    });
    await page.setContent(html);
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await browser.close();
  }
}
