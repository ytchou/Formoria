/**
 * A record/replay cache for every non-OpenAI HTTP call the pipeline makes.
 *
 * The first A/B run records serper.dev responses, scraped page bodies, and
 * downloaded image bytes to disk. The second run replays them byte for byte.
 * Without this the two models are not comparable: serper returned a 58%-overlapping
 * image set across two runs minutes apart, so each model was judging a partly
 * different set of pictures and the difference in their verdicts was partly just
 * the difference in their inputs.
 *
 * OpenAI is deliberately never cached — that is the one call whose output is the
 * thing under test.
 *
 * The key is method + URL + body hash, so a replay that issues a request the
 * recording never made is a hard error rather than a silent live call. That
 * matters: a silent fallthrough would reintroduce exactly the drift this exists
 * to remove, and would do it invisibly.
 */
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Mode = "record" | "replay" | "off";

/**
 * Never cached. OpenAI is the thing under test. Supabase is exempt for a
 * different reason: its reads are of rows nothing in this harness writes, so
 * they are already stable between runs, and caching them would turn a harmless
 * query-shape difference into an aborted run.
 */
const PASSTHROUGH_HOSTS = ["api.openai.com"];
let extraPassthrough: string[] = [];

let mode: Mode = "off";
let cacheDir = "";
const stats = { recorded: 0, replayed: 0, passthrough: 0 };

function keyFor(url: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : "";
  return createHash("sha256")
    .update(`${method}\n${url}\n${body}`)
    .digest("hex")
    .slice(0, 32);
}

function isPassthrough(url: string): boolean {
  return [...PASSTHROUGH_HOSTS, ...extraPassthrough].some(
    (host) => host.length > 0 && url.includes(host),
  );
}

type StoredResponse = {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
};

export function installHttpCache(
  dir: string,
  requestedMode: Mode,
  alsoPassthrough: string[] = [],
): void {
  mode = requestedMode;
  cacheDir = dir;
  extraPassthrough = alsoPassthrough;
  if (mode === "off") return;
  mkdirSync(cacheDir, { recursive: true });

  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (isPassthrough(url)) {
      stats.passthrough += 1;
      return realFetch(input as RequestInfo, init);
    }

    const path = join(cacheDir, `${keyFor(url, init)}.json`);

    if (mode === "replay") {
      if (!existsSync(path)) {
        throw new Error(
          `http-cache replay miss: ${(init?.method ?? "GET").toUpperCase()} ${url}\n` +
            `  The recording run never made this request. Re-record rather than falling through to the network — ` +
            `a live call here would silently un-freeze the comparison.`,
        );
      }
      const stored = JSON.parse(readFileSync(path, "utf8")) as StoredResponse;
      stats.replayed += 1;
      return new Response(Buffer.from(stored.bodyBase64, "base64"), {
        status: stored.status,
        statusText: stored.statusText,
        headers: stored.headers,
      });
    }

    // record
    const response = await realFetch(input as RequestInfo, init);
    const buffer = Buffer.from(await response.clone().arrayBuffer());
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const stored: StoredResponse = {
      url,
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyBase64: buffer.toString("base64"),
    };
    writeFileSync(path, JSON.stringify(stored));
    stats.recorded += 1;
    return response;
  }) as typeof globalThis.fetch;
}

export function httpCacheStats(): typeof stats {
  return stats;
}
