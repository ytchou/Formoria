import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
        { id: "F_RECOVERED", title: "evidence.md" },
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
  const root = await mkdtemp(join(tmpdir(), "editorial-delivery-"));
  roots.push(root);
  const store = new RunStore(root);
  await store.initialize();
  const { run } = await store.start({
    requestId: "maria-evidence-delivery",
    operatorSlackId: "U_MARIA_GARCIA",
    channelId: "C_FORMORIA_EDITORIAL",
    threadTs: "1791043200.000100",
    brief: "小宅聖誕禮物",
  });
  await store.update(run.id, (current) => {
    current.status = "ready_for_review";
    current.trail = {
      title: "閱讀角落的禮物",
      description: "一份等待人類選擇的提案。",
      slug: "reading-corner-gifts",
      promise: "讓角落更容易開始閱讀。",
      readerSituation: "晚上的燈照不到書頁。",
      exclusions: "不處理裝修。",
      intro: "這是一份等待人類選擇的提案。",
      sections: [
        { key: "light", title: "先讓光線到位", body: "先看光。", picks: [] },
      ],
      closing: "",
    };
    current.draft = "# 閱讀角落的禮物\n\n這是一份等待人類選擇的提案。";
    current.budget.modelAttempts = 8;
  });
  vi.stubEnv("SLACK_BOT_TOKEN", "fixture-slack-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  let uploads = 0;
  let completions = 0;
  const delivered: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/files.getUploadURLExternal")) {
      uploads++;
      return Response.json({
        ok: true,
        file_id: "F_MARIA_" + uploads,
        upload_url: "https://files.slack.com/upload/editorial-" + uploads,
      });
    }
    if (url.startsWith("https://files.slack.com/upload/")) {
      delivered.push(String(init?.body));
      return new Response("ok");
    }
    if (url.endsWith("/files.completeUploadExternal")) {
      completions++;
      const payload = JSON.parse(String(init?.body));
      expect(payload.thread_ts).toBe(run.threadTs);
      return Response.json(
        completions === 1 ? { ok: false, error: "ratelimited" } : { ok: true },
      );
    }
    if (url.endsWith("/chat.postMessage"))
      return Response.json({ ok: true, ts: "1791043201.000100" });
    throw new Error("Unexpected provider call");
  });
  await expect(deliverRun(store, run.id)).rejects.toThrow("ratelimited");
  expect((await readdir(join(root, run.id))).sort()).toEqual(
    expect.arrayContaining(["evidence.md", "picks.json", "trail.mdx"]),
  );
  expect((await store.read(run.id)).delivery.files["trail.mdx"]).toMatchObject({
    fileId: "F_MARIA_1",
    uploaded: true,
    completed: false,
  });
  await deliverRun(store, run.id);
  const complete = await store.read(run.id);
  expect(complete.delivery.files["trail.mdx"]?.completed).toBe(true);
  expect(complete.delivery.files["picks.json"]?.completed).toBe(true);
  expect(complete.delivery.files["evidence.md"]?.completed).toBe(true);
  expect(complete.delivery.summarySent).toBe(true);
  expect(complete.budget.modelAttempts).toBe(8);
  expect(uploads).toBe(3);
  expect(delivered.at(0)).toContain("閱讀角落");
  expect(delivered.at(1)).toContain('"trail": "reading-corner-gifts"');
  expect(delivered.at(2)).toContain("Claim evidence");
});
