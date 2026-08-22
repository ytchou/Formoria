import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const workflowPath = ".github/workflows/production-probe.yml";

interface WorkflowStep {
  env?: Record<string, string>;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface Workflow {
  concurrency?: { "cancel-in-progress"?: boolean; group?: string };
  jobs: Record<
    string,
    {
      environment?: string;
      if?: string;
      steps: WorkflowStep[];
    }
  >;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  true?: Record<string, unknown>;
}

async function loadWorkflow(): Promise<Workflow> {
  return parseYaml(await readFile(workflowPath, "utf8")) as Workflow;
}

// `on:` parses to the YAML 1.1 boolean `true`, so read whichever key survived.
function triggers(workflow: Workflow): Record<string, unknown> {
  return (workflow.on ?? workflow.true ?? {}) as Record<string, unknown>;
}

function probeJob(workflow: Workflow) {
  const job = Object.values(workflow.jobs)[0];
  expect(job).toBeDefined();
  return job;
}

const REQUIRED_CREDENTIALS = [
  "PRODUCTION_BASE_URL",
  "SLACK_HEALTH_WEBHOOK_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

describe("production probe workflow", () => {
  it("workflow schedules every thirty minutes", async () => {
    const on = triggers(await loadWorkflow());
    const schedule = on.schedule as { cron: string }[];

    expect(schedule.map((entry) => entry.cron)).toContain("*/30 * * * *");
    expect(Object.keys(on)).toContain("workflow_dispatch");
  });

  it("workflow is gated on PRODUCTION_PROBE_ENABLED", async () => {
    const job = probeJob(await loadWorkflow());

    expect(job.if).toContain("PRODUCTION_PROBE_ENABLED");
    expect(job.if).toContain("'true'");
  });

  it("workflow documents that the gate variable must be repository-scoped", async () => {
    const raw = await readFile(workflowPath, "utf8");
    const lines = raw.split("\n");
    const gateIndex = lines.findIndex((line) =>
      /^\s*if:.*PRODUCTION_PROBE_ENABLED/.test(line),
    );
    expect(gateIndex).toBeGreaterThan(0);

    // The comment block immediately above the gate is the only place an
    // operator learns that a job-level `if` cannot see environment-scoped vars.
    const comment: string[] = [];
    for (let index = gateIndex - 1; index >= 0; index -= 1) {
      const line = lines[index] ?? "";
      if (!/^\s*#/.test(line)) break;
      comment.unshift(line);
    }
    const text = comment.join(" ");

    expect(text).toMatch(/repository-level/i);
    expect(text).toMatch(/environment/i);
  });

  it("workflow uses the production environment", async () => {
    const job = probeJob(await loadWorkflow());

    expect(job.environment).toBe("Formoria / production");
  });

  it("workflow preflights every required credential", async () => {
    const job = probeJob(await loadWorkflow());
    const preflight = job.steps.find((step) =>
      /credential/i.test(step.name ?? ""),
    );

    expect(preflight).toBeDefined();
    for (const name of REQUIRED_CREDENTIALS) {
      expect(Object.keys(preflight?.env ?? {})).toContain(name);
      expect(preflight?.run ?? "").toContain(name);
    }

    const probeStep = job.steps.find((step) =>
      (step.run ?? "").includes("scripts/production-probe/probe.ts"),
    );
    expect(probeStep).toBeDefined();
    for (const name of REQUIRED_CREDENTIALS) {
      expect(Object.keys(probeStep?.env ?? {})).toContain(name);
    }
  });

  it("workflow pins every third-party action to a SHA", async () => {
    const raw = await readFile(workflowPath, "utf8");
    const uses = [...raw.matchAll(/^\s*uses:\s*(\S+)/gm)].map(
      (match) => match[1],
    );

    expect(uses.length).toBeGreaterThan(0);
    for (const reference of uses) {
      expect(reference).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("workflow serialises overlapping runs", async () => {
    const workflow = await loadWorkflow();

    expect(workflow.concurrency?.group).toBe("production-probe");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("workflow caches probe state across runs", async () => {
    const job = probeJob(await loadWorkflow());
    const cacheSteps = job.steps.filter((step) =>
      (step.uses ?? "").startsWith("actions/cache"),
    );

    expect(cacheSteps.length).toBeGreaterThanOrEqual(2);
    for (const step of cacheSteps) {
      expect(step.with?.key).toContain("probe-state-");
      expect(step.with?.["restore-keys"] ?? "probe-state-").toContain(
        "probe-state-",
      );
    }
  });

  it("workflow grants no more than read access to contents", async () => {
    const workflow = await loadWorkflow();

    expect(workflow.permissions).toEqual({ contents: "read" });
  });
});
