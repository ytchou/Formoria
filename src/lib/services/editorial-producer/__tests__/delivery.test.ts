import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../../curated-products-catalog";
import { RunStore } from "../store";
import { deliverRun } from "../delivery";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const product: CatalogProduct = {
  id: "luminaire-maple-desk",
  key: "maple-desk-lamp",
  nameZh: "楓木桌燈",
  nameEn: "Maple desk lamp",
  brandSlug: "river-woodwork",
  brandName: "河岸木作",
  category: "home-living",
  subcategory: "lighting",
  material: ["wood"],
  createdAt: "2026-09-01T00:00:00Z",
  imageUrl: null,
  officialUrl: "https://river-woodwork.example/products/maple-desk",
  productDescriptionZh: "小桌面的閱讀燈",
  productDescriptionEn: null,
  brand: {
    slug: "river-woodwork",
    purchaseWebsite: "https://river-woodwork.example",
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
  },
};
/** A Chromium stand-in: records the HTML it was given and returns fixed bytes. */
function fakeBrowser() {
  const pages: string[] = [];
  const launch = async () =>
    ({
      newPage: async () => ({
        setContent: async (html: string) => {
          pages.push(html);
        },
        screenshot: async () => Buffer.from("fixture-png-bytes"),
      }),
      close: async () => {},
    }) as unknown as Browser;
  return { launch, pages };
}
async function readyRun(slug = "reading-corner-gifts") {
  const root = await mkdtemp(join(tmpdir(), "editorial-delivery-"));
  roots.push(root);
  const store = new RunStore(root);
  await store.initialize();
  const { run } = await store.start({
    requestId: "maria-evidence-delivery-" + slug,
    operatorSlackId: "U_MARIA_GARCIA",
    channelId: "C_FORMORIA_EDITORIAL",
    threadTs: "1791043200.000100",
    brief: "小宅聖誕禮物",
  });
  await store.update(run.id, (current) => {
    current.status = "ready_for_review";
    current.catalog = [product];
    current.trail = {
      title: "閱讀角落的禮物",
      description: "一份等待人類選擇的提案。",
      slug,
      promise: "讓角落更容易開始閱讀。",
      readerSituation: "晚上的燈照不到書頁。",
      exclusions: "不處理裝修。",
      intro: "這是一份等待人類選擇的提案。",
      sections: [
        {
          key: "light",
          title: "先讓光線到位",
          body: "先看光。",
          picks: [{ productId: product.id, note: "楓木燈座", factIds: [] }],
        },
      ],
      closing: "",
    };
    current.draft = "# 閱讀角落的禮物\n\n這是一份等待人類選擇的提案。";
    current.budget.costUsd = 0.0919;
    current.budget.modelAttempts = 8;
  });
  vi.stubEnv("SLACK_BOT_TOKEN", "fixture-slack-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { root, store, run };
}
/** Slack stand-in recording each call in order; completion answers are scripted. */
function slack(completionAnswers: Array<Record<string, unknown>> = []) {
  const calls: string[] = [];
  const completions: Array<Array<{ id: string; title: string }>> = [];
  const messages: string[] = [];
  const uploaded: unknown[] = [];
  let admissions = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/files.getUploadURLExternal")) {
      admissions++;
      calls.push(
        "admit:" + new URLSearchParams(String(init?.body)).get("filename"),
      );
      return Response.json({
        ok: true,
        file_id: "F_MARIA_" + admissions,
        upload_url: "https://files.slack.com/upload/editorial-" + admissions,
      });
    }
    if (url.startsWith("https://files.slack.com/upload/")) {
      uploaded.push(init?.body);
      return new Response("ok");
    }
    if (url.endsWith("/files.completeUploadExternal")) {
      calls.push("complete");
      const payload = JSON.parse(String(init?.body));
      completions.push(payload.files);
      return Response.json(completionAnswers.shift() ?? { ok: true });
    }
    if (url.endsWith("/chat.postMessage")) {
      calls.push("post");
      // Blocks too: the short run ID lives in the notice's context block.
      const body = JSON.parse(String(init?.body));
      messages.push(body.text + "\n" + JSON.stringify(body.blocks ?? []));
      return Response.json({ ok: true, ts: "1791043201.000100" });
    }
    throw new Error("Unexpected provider call");
  });
  return {
    calls,
    completions,
    messages,
    uploaded,
    admissions: () => admissions,
  };
}
it("recovers an interrupted completion without replaying Slack's one-shot operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-ambiguous-delivery-"));
  roots.push(root);
  const store = new RunStore(root);
  await store.initialize();
  const { run } = await store.start({
    requestId: "maria-delivery-lost-acknowledgement",
    operatorSlackId: "U_MARIA_GARCIA",
    channelId: "C_FORMORIA_EDITORIAL",
    threadTs: "1791043200.000100",
    brief: "小宅聖誕禮物",
  });
  await store.update(run.id, (current) => {
    current.status = "blocked";
    current.budget.modelAttempts = 4;
    current.delivery.files["evidence.md"] = {
      fileId: "F_LOST_ACK",
      uploaded: true,
      completed: false,
      completionStarted: true,
    };
  });
  vi.stubEnv("SLACK_BOT_TOKEN", "fixture-slack-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/files.getUploadURLExternal"))
      return Response.json({
        ok: true,
        file_id: "F_RECOVERED",
        upload_url: "https://files.slack.com/upload/recovered",
      });
    if (url.includes("/upload/")) return new Response("ok");
    if (url.endsWith("/files.completeUploadExternal")) {
      expect(JSON.parse(String(init?.body)).files).toEqual([
        {
          id: "F_RECOVERED",
          title: "editorial-" + run.id.slice(0, 8) + ".evidence.md",
        },
      ]);
      return Response.json({ ok: true });
    }
    if (url.endsWith("/chat.postMessage"))
      return Response.json({ ok: true, ts: "1791043201.000100" });
    throw new Error("Unexpected provider call");
  });
  await deliverRun(store, run.id);
  const saved = await store.read(run.id);
  expect(saved.delivery.files["evidence.md"]).toMatchObject({
    fileId: "F_RECOVERED",
    completed: true,
  });
  expect(saved.budget.modelAttempts).toBe(4);
});
it("retries failed attachment completion using the saved file without regenerating or reuploading", async () => {
  const { root, store, run } = await readyRun();
  const browser = fakeBrowser();
  const provider = slack([{ ok: false, error: "ratelimited" }]);
  await expect(
    deliverRun(store, run.id, { launch: browser.launch }),
  ).rejects.toThrow("ratelimited");
  expect((await readdir(join(root, run.id))).sort()).toEqual(
    expect.arrayContaining([
      "evidence.md",
      "picks.json",
      "preview.png",
      "trail.mdx",
    ]),
  );
  expect((await store.read(run.id)).delivery.files["trail.mdx"]).toMatchObject({
    fileId: "F_MARIA_2",
    uploaded: true,
    completed: false,
    completionStarted: false,
  });
  await deliverRun(store, run.id, { launch: browser.launch });
  const complete = await store.read(run.id);
  for (const name of ["preview.png", "trail.mdx", "picks.json", "evidence.md"])
    expect(complete.delivery.files[name]?.completed).toBe(true);
  expect(complete.delivery.summarySent).toBe(true);
  expect(complete.budget.modelAttempts).toBe(8);
  expect(provider.admissions()).toBe(4);
  expect(provider.completions).toHaveLength(2);
  expect(provider.completions.at(1)).toEqual(provider.completions.at(0));
  expect(provider.uploaded.at(0)).toBeInstanceOf(Uint8Array);
  expect(String(provider.uploaded.at(1))).toContain("閱讀角落");
  expect(String(provider.uploaded.at(2))).toContain(
    '"trail": "reading-corner-gifts"',
  );
  expect(String(provider.uploaded.at(3))).toContain("Claim evidence");
});
it("completes every attachment in one Slack message named from the trail slug, then posts the summary", async () => {
  const { store, run } = await readyRun();
  const browser = fakeBrowser();
  const provider = slack();
  await deliverRun(store, run.id, { launch: browser.launch });
  expect(provider.calls).toEqual([
    "admit:reading-corner-gifts-preview.png",
    "admit:reading-corner-gifts.mdx",
    "admit:reading-corner-gifts.picks.json",
    "admit:reading-corner-gifts.evidence.md",
    "complete",
    "post",
  ]);
  expect(provider.completions).toEqual([
    [
      { id: "F_MARIA_1", title: "reading-corner-gifts-preview.png" },
      { id: "F_MARIA_2", title: "reading-corner-gifts.mdx" },
      { id: "F_MARIA_3", title: "reading-corner-gifts.picks.json" },
      { id: "F_MARIA_4", title: "reading-corner-gifts.evidence.md" },
    ],
  ]);
  expect(browser.pages).toHaveLength(1);
  expect(browser.pages.at(0)).toContain("楓木桌燈");
});
it("summarises the draft with sections, checks, usage and a short run ID", async () => {
  const { store, run } = await readyRun();
  const provider = slack();
  await deliverRun(store, run.id, { launch: fakeBrowser().launch });
  const summary = provider.messages.at(-1) ?? "";
  expect(summary).toContain("Editorial draft ready for review");
  expect(summary).toContain("*閱讀角落的禮物*");
  expect(summary).toContain("一份等待人類選擇的提案。");
  expect(summary).toContain("先讓光線到位 — 1 product");
  expect(summary).toContain("zh-TW ✓");
  expect(summary).toContain("Model usage: US$0.09 of the US$1 cap");
  expect(summary).toContain("Next: review the preview and files above.");
  expect(summary).toContain("Run " + run.id.slice(0, 8));
  expect(summary).not.toContain(run.id);
});
it("delivers without the preview when rendering fails, and says so in the summary", async () => {
  const { store, run } = await readyRun();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const provider = slack();
  await deliverRun(store, run.id, {
    launch: async () => {
      throw new Error("Executable doesn't exist");
    },
  });
  expect(provider.completions).toEqual([
    [
      { id: "F_MARIA_1", title: "reading-corner-gifts.mdx" },
      { id: "F_MARIA_2", title: "reading-corner-gifts.picks.json" },
      { id: "F_MARIA_3", title: "reading-corner-gifts.evidence.md" },
    ],
  ]);
  const saved = await store.read(run.id);
  expect(saved.delivery.summarySent).toBe(true);
  expect(saved.delivery.files["preview.png"]).toBeUndefined();
  expect(provider.messages.at(-1)).toContain(
    "The preview image could not be rendered",
  );
});
