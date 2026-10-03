import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import {
  emptyBudget,
  ownsRun,
  TERMINAL,
  type Run,
  type StartInput,
} from "./types";

export class RunStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {
    if (!isAbsolute(root))
      throw new Error(
        "EDITORIAL_PRODUCER_RUNS_DIR must be an absolute durable path",
      );
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.pending.then(fn);
    this.pending = work.catch(() => {});
    return work;
  }
  private path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid run ID");
    return join(this.root, id);
  }
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const unfinished: Run[] = [];
    for (const id of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      const run = await this.read(id);
      if (run.status === "running") {
        if (run.activeStartedAt)
          run.budget.activeMs += Math.max(
            0,
            Date.now() - Date.parse(run.activeStartedAt),
          );
        run.activeStartedAt = null;
        run.status = "interrupted";
        await this.save(run);
      }
      if (!TERMINAL.has(run.status)) unfinished.push(run);
    }
    if (unfinished.length > 1)
      throw new Error(
        "Multiple unfinished runs: repair durable admission before startup",
      );
    await rm(join(this.root, "active"), { recursive: true, force: true });
    const active = unfinished.at(0);
    if (active) {
      await mkdir(join(this.root, "active"));
      await this.atomic(join(this.root, "active", "owner.json"), {
        id: active.id,
      });
    }
    await this.atomic(join(this.root, "storage-check.json"), {
      checkedAt: new Date().toISOString(),
    });
  }
  async read(id: string): Promise<Run> {
    return JSON.parse(
      await readFile(join(this.path(id), "manifest.json"), "utf8"),
    ) as Run;
  }
  private async atomic(path: string, value: unknown) {
    const tmp = path + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(tmp, path);
  }
  private async save(run: Run) {
    run.updatedAt = new Date().toISOString();
    await this.atomic(join(this.path(run.id), "manifest.json"), run);
  }
  async active(): Promise<Run | null> {
    try {
      const owner = JSON.parse(
        await readFile(join(this.root, "active", "owner.json"), "utf8"),
      ) as { id: string };
      return this.read(owner.id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async start(
    input: StartInput,
  ): Promise<{ accepted: boolean; duplicate?: boolean; run: Run }> {
    return this.serial(async () => {
      const id = createHash("sha256").update(input.requestId).digest("hex");
      try {
        const run = await this.read(id);
        if (!ownsRun(run, input) || run.input !== input.brief)
          throw new Error("Start identity mismatch");
        return { accepted: true, duplicate: true, run };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const current = await this.active();
      if (current && !TERMINAL.has(current.status))
        return { accepted: false, run: current };
      if (current)
        await rm(join(this.root, "active"), { recursive: true, force: true });
      await mkdir(join(this.root, "active"));
      const now = new Date().toISOString();
      const run: Run = {
        version: 1,
        id,
        requestId: input.requestId,
        input: input.brief,
        operatorSlackId: input.operatorSlackId,
        channelId: input.channelId,
        threadTs: input.threadTs,
        createdAt: now,
        updatedAt: now,
        status: "running",
        stage: "brief",
        budget: emptyBudget(),
        activeStartedAt: null,
        price: null,
        question: null,
        answers: [],
        processedEvents: [],
        exclusions: [],
        sources: [],
        facts: [],
        claims: [],
        delivery: { files: {}, summarySent: false },
      };
      await mkdir(this.path(id), { mode: 0o700 });
      await this.save(run);
      await this.atomic(join(this.root, "active", "owner.json"), { id });
      return { accepted: true, run };
    });
  }
  async update(id: string, mutate: (run: Run) => void): Promise<Run> {
    return this.serial(async () => {
      const run = await this.read(id);
      mutate(run);
      await this.save(run);
      if (TERMINAL.has(run.status)) {
        const current = await this.active();
        if (current?.id === id)
          await rm(join(this.root, "active"), { recursive: true, force: true });
      }
      return run;
    });
  }
  async artifact(id: string, name: string, contents: string): Promise<void> {
    if (!/^[a-z0-9-]+\.(json|md)$/.test(name))
      throw new Error("Invalid artifact name");
    const path = join(this.path(id), name);
    const tmp = path + "." + randomUUID() + ".tmp";
    await writeFile(tmp, contents, { mode: 0o600 });
    await rename(tmp, path);
  }
  async journal(id: string, event: unknown): Promise<void> {
    await this.serial(() =>
      appendFile(
        join(this.path(id), "audit.jsonl"),
        JSON.stringify({ at: new Date().toISOString(), ...(event as object) }) +
          "\n",
        { mode: 0o600 },
      ),
    );
  }
}
