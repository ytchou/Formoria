import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEditorialWorker } from "./server";
import { ProducerController } from "@/lib/services/editorial-producer/controller";
import { RunStore } from "@/lib/services/editorial-producer/store";

it("requires worker authentication and originating ownership while rejecting a second waiting run", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-http-"));
  const store = new RunStore(root);
  await store.initialize();
  const owner = {
    operatorSlackId: "U_MARIA_GARCIA",
    channelId: "C_FORMORIA_EDITORIAL",
    threadTs: "1791043200.000100",
  };
  const input = {
    ...owner,
    requestId: "maria-http-start",
    brief: "小宅聖誕禮物",
  };
  const { run } = await store.start(input);
  await store.update(run.id, (current) => {
    current.status = "awaiting_input";
  });
  const worker = createEditorialWorker(
    new ProducerController(store),
    "fixture-internal-worker-token",
  );
  await new Promise<void>((done, reject) => {
    worker.server.once("error", reject);
    worker.server.listen(0, "127.0.0.1", done);
  }).catch(async (error) => {
    await rm(root, { recursive: true, force: true });
    throw error;
  });
  const address = worker.server.address();
  if (!address || typeof address === "string")
    throw new Error("No test listener");
  const base = "http://127.0.0.1:" + address.port;
  async function post(path: string, data: unknown, authorized = true) {
    return fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorized
          ? { Authorization: "Bearer fixture-internal-worker-token" }
          : {}),
      },
      body: JSON.stringify(data),
    });
  }
  try {
    expect((await post("/runs/start", input, false)).status).toBe(401);
    const busy = await post("/runs/start", {
      ...input,
      requestId: "maria-second-run",
    });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      accepted: false,
      duplicate: false,
      status: "awaiting_input",
    });
    const duplicate = await post("/runs/start", input);
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toMatchObject({
      runId: run.id,
      duplicate: true,
    });
    const forbidden = await post("/runs/command", {
      ...owner,
      operatorSlackId: "U_OTHER_OPERATOR",
      runId: run.id,
      command: "cancel",
      eventId: "other-operator-cancel",
    });
    expect(forbidden.status).toBe(400);
    expect((await store.read(run.id)).status).toBe("awaiting_input");
    const status = await post("/runs/command", {
      ...owner,
      runId: run.id,
      command: "status",
      eventId: "maria-status",
    });
    expect(await status.json()).toMatchObject({
      status: "awaiting_input",
      stage: "brief",
    });
    const cancel = await post("/runs/command", {
      ...owner,
      runId: run.id,
      command: "cancel",
      eventId: "maria-cancel",
    });
    expect(await cancel.json()).toMatchObject({ status: "cancelled" });
    expect(await store.active()).toBeNull();
  } finally {
    await worker.stop();
    await rm(root, { recursive: true, force: true });
  }
});
