import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RunStore } from "../store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const owner = {
  operatorSlackId: "U_MARIA_GARCIA",
  channelId: "C_FORMORIA_EDITORIAL",
  threadTs: "1791043200.000100",
};
async function store() {
  const root = await mkdtemp(join(tmpdir(), "editorial-producer-"));
  roots.push(root);
  const result = new RunStore(root);
  await result.initialize();
  return result;
}

it("keeps a waiting run exclusive and deduplicates its original start", async () => {
  const runs = await store();
  const first = await runs.start({
    ...owner,
    requestId: "request-maria-christmas",
    brief: "聖誕節送給小宅屋主的禮物",
  });
  expect(first.accepted).toBe(true);
  await runs.update(first.run.id, (run) => {
    run.status = "awaiting_input";
  });
  const duplicate = await runs.start({
    ...owner,
    requestId: "request-maria-christmas",
    brief: "聖誕節送給小宅屋主的禮物",
  });
  expect(duplicate.run.id).toBe(first.run.id);
  const next = await runs.start({
    ...owner,
    requestId: "request-maria-reading",
    brief: "閱讀角落選物",
  });
  expect(next.accepted).toBe(false);
  expect(next.run.status).toBe("awaiting_input");
});

it("admits exactly one simultaneous request and restores interrupted ownership after restart", async () => {
  const runs = await store();
  const results = await Promise.all(
    ["request-maria-one", "request-maria-two"].map((requestId) =>
      runs.start({ ...owner, requestId, brief: "小宅聖誕節禮物" }),
    ),
  );
  expect(results.filter((result) => result.accepted)).toHaveLength(1);
  const first = results.find((result) => result.accepted)!.run;
  await runs.update(first.id, (run) => {
    run.budget.modelAttempts = 7;
    run.status = "running";
  });
  await rm(join(runs.root, "active"), { recursive: true, force: true });
  const restarted = new RunStore(runs.root);
  await restarted.initialize();
  expect((await restarted.read(first.id)).status).toBe("interrupted");
  expect((await restarted.read(first.id)).budget.modelAttempts).toBe(7);
  expect(
    (
      await restarted.start({
        ...owner,
        requestId: "request-maria-three",
        brief: "閱讀角落",
      })
    ).accepted,
  ).toBe(false);
  await restarted.update(first.id, (run) => {
    run.status = "cancelled";
  });
  expect(
    (
      await restarted.start({
        ...owner,
        requestId: "request-maria-three",
        brief: "閱讀角落",
      })
    ).accepted,
  ).toBe(true);
});
