import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getPublishedCuratedProducts } from "../curated-products-catalog";
import { getStoryBySlug } from "../stories";
import { getTrailBySlug } from "../trails";
import {
  fetchHtmlWithMetadata,
  isPrivateUrl,
} from "../enrich-phases/scraper/fetch-guards";
import { extractRenderedMainText } from "../enrich-phases/scraper/product-origin-text";
import type { RenderProvider } from "../enrich-phases/scraper/render/types";
import { reserveFetch } from "./budget";
import type { RunStore } from "./store";
import type { ContentIntent, Source } from "./types";

export async function loadContext() {
  const [catalog, content] = await Promise.all([
    getPublishedCuratedProducts({ pageSize: Number.MAX_SAFE_INTEGER }),
    loadContent(),
  ]);
  if (catalog.products.length !== catalog.totalCount)
    throw new Error("Incomplete catalog snapshot");
  return { catalog: catalog.products, content };
}
export async function loadContent(): Promise<ContentIntent[]> {
  const groups = await Promise.all(
    (["story", "trail"] as const).map(async (kind) => {
      const files = await readdir(
        join(process.cwd(), "content", kind === "story" ? "stories" : "trails"),
      );
      return Promise.all(
        files
          .filter((file) => file.endsWith(".mdx"))
          .map(async (file) => {
            const slug = file.slice(0, -4);
            const result =
              kind === "story"
                ? await getStoryBySlug(slug)
                : await getTrailBySlug(slug);
            if (!result)
              throw new Error("Cannot inspect content intent: " + slug);
            const entry = result.entry.frontmatter;
            return {
              slug,
              kind,
              title: entry.title,
              intent:
                ("readerSituation" in entry
                  ? entry.readerSituation
                  : undefined) ||
                entry.description ||
                entry.title,
              draft: entry.draft,
              content: result.content,
              hash: createHash("sha256").update(result.content).digest("hex"),
            } satisfies ContentIntent;
          }),
      );
    }),
  );
  return groups.flat();
}
export async function fetchSource(
  store: RunStore,
  runId: string,
  productId: string,
  url: string,
  renderer: RenderProvider,
  signal: AbortSignal,
): Promise<Source | null> {
  if (isPrivateUrl(url)) throw new Error("Official source URL is not public");
  await store.update(runId, (run) => {
    reserveFetch(run.budget, url);
  });
  const result = await fetchHtmlWithMetadata(url, {
    signal,
    includeFinalUrl: true,
  });
  await store.journal(runId, {
    provider: "http",
    operation: "fetch_html_with_metadata",
    request: { url },
    response: result,
    latencyMs: result.latencyMs,
    status: result.status,
  });
  let text = result.text ? extractRenderedMainText(result.text) : "";
  let finalUrl = result.finalUrl || url;
  let status = result.status ?? 0;
  let mode: Source["mode"] = "static";
  if (!text && !signal.aborted && !result.error?.includes("private")) {
    await store.update(runId, (run) => {
      reserveFetch(run.budget, url);
    });
    const start = Date.now();
    let rendered: Awaited<ReturnType<RenderProvider["fetchRendered"]>>;
    try {
      rendered = await renderer.fetchRendered(url);
    } catch (error) {
      await store.journal(runId, {
        provider: "playwright",
        operation: "fetch_rendered",
        request: { url },
        response: null,
        latencyMs: Date.now() - start,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      if (signal.aborted) signal.throwIfAborted();
      return null;
    }
    await store.journal(runId, {
      provider: "playwright",
      operation: "fetch_rendered",
      request: { url },
      response: rendered,
      latencyMs: Date.now() - start,
      status: rendered.status,
    });
    text = extractRenderedMainText(rendered.html);
    finalUrl = rendered.finalUrl;
    status = rendered.status;
    mode = "rendered";
  }
  signal.throwIfAborted();
  if (!text || status < 200 || status >= 300 || isPrivateUrl(finalUrl))
    return null;
  return {
    id: createHash("sha256")
      .update(productId + finalUrl)
      .digest("hex")
      .slice(0, 20),
    productId,
    requestedUrl: url,
    finalUrl,
    text,
    status,
    mode,
    fetchedAt: new Date().toISOString(),
  };
}
