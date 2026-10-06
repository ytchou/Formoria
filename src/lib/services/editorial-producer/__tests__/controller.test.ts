import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ProducerController } from "../controller";
import { RunStore } from "../store";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const owner = {
  operatorSlackId: "U_MARIA_GARCIA",
  channelId: "C_FORMORIA_EDITORIAL",
  threadTs: "1791043200.000100",
};
async function blockedRun() {
  const root = await mkdtemp(join(tmpdir(), "editorial-controller-"));
  roots.push(root);
  const store = new RunStore(root);
  await store.initialize();
  const { run } = await store.start({
    ...owner,
    requestId: "maria-retry-delivery",
    brief: "小宅聖誕禮物",
  });
  await store.update(run.id, (current) => {
    current.status = "blocked";
    current.delivery.error = "Slack file admission failed: invalid_arguments";
  });
  vi.stubEnv("SLACK_BOT_TOKEN", "fixture-slack-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { store, id: run.id };
}
it("answers retry delivery before the upload finishes and refuses a second retry meanwhile", async () => {
  const { store, id } = await blockedRun();
  let admit: () => void = () => {};
  const admitted = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const posted: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/files.getUploadURLExternal")) {
      await admitted;
      return Response.json({
        ok: true,
        file_id: "F_RETRY",
        upload_url: "https://files.slack.com/upload/retry",
      });
    }
    if (url.includes("/upload/")) return new Response("ok");
    if (url.endsWith("/files.completeUploadExternal"))
      return Response.json({ ok: true });
    if (url.endsWith("/chat.postMessage")) {
      posted.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true, ts: "1791043201.000100" });
    }
    throw new Error("Unexpected provider call");
  });
  const controller = new ProducerController(store);
  try {
    const summary = await controller.command({
      ...owner,
      runId: id,
      command: "retry_delivery",
      eventId: "maria-retry-1",
    });
    expect(summary.deliveryError).toBeNull();
    expect((await store.read(id)).processedEvents).toContain("maria-retry-1");
    expect((await store.read(id)).delivery.summarySent).toBe(false);
    await expect(
      controller.command({
        ...owner,
        runId: id,
        command: "retry_delivery",
        eventId: "maria-retry-2",
      }),
    ).rejects.toThrow("Delivery is already in progress");
    const replay = await controller.command({
      ...owner,
      runId: id,
      command: "retry_delivery",
      eventId: "maria-retry-1",
    });
    expect(replay.runId).toBe(id);
  } finally {
    admit();
    await controller.shutdown();
  }
  const saved = await store.read(id);
  expect(saved.delivery.summarySent).toBe(true);
  expect(saved.delivery.error).toBeUndefined();
  expect(posted).toHaveLength(1);
});
it("posts a failure notice to the thread when a retried upload fails", async () => {
  const { store, id } = await blockedRun();
  const posted: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/files.getUploadURLExternal"))
      return Response.json({
        ok: true,
        file_id: "F_RETRY",
        upload_url: "https://files.slack.com/upload/retry",
      });
    if (url.includes("/upload/")) return new Response("busy", { status: 503 });
    if (url.endsWith("/chat.postMessage")) {
      posted.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true, ts: "1791043201.000100" });
    }
    throw new Error("Unexpected provider call");
  });
  const controller = new ProducerController(store);
  await controller.command({
    ...owner,
    runId: id,
    command: "retry_delivery",
    eventId: "maria-retry-failing",
  });
  await controller.shutdown();
  const saved = await store.read(id);
  expect(saved.delivery.error).toBe("Slack file upload failed: 503");
  expect(posted).toHaveLength(1);
  expect(posted.at(0)).toContain("Attachment delivery failed");
  expect(posted.at(0)).toContain(
    "Slack file upload failed: 503. Reply `retry delivery` in this thread to try again.",
  );
});
it("keeps the retry quiet when even the failure notice cannot be posted", async () => {
  const { store, id } = await blockedRun();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("Slack unreachable");
  });
  const controller = new ProducerController(store);
  await controller.command({
    ...owner,
    runId: id,
    command: "retry_delivery",
    eventId: "maria-retry-offline",
  });
  await controller.shutdown();
  expect((await store.read(id)).delivery.error).toContain("Slack unreachable");
  expect(errors).toHaveBeenCalledWith(
    "[editorial-producer] failure notice not posted",
    expect.stringContaining("Slack unreachable"),
  );
});
