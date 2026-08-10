import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createTestClient, describeWithDb } from "@/test/setup";
import { getPersonalOsCurationRuns } from "../personal-os-curation-runs";

const createdJobIds = new Set<string>();

describeWithDb("Personal OS curation run projection integration", () => {
  afterEach(async () => {
    const client = createTestClient();
    for (const id of createdJobIds) {
      await client.from("curation_jobs").delete().eq("id", id);
    }
    createdJobIds.clear();
  });

  // Bug caught: a Personal OS consumer could receive raw curation job secrets instead of the safe run projection.
  it("returns a sanitized versioned run and honors the limit against the real queue", async () => {
    const client = createTestClient();
    const { data: jobId, error } = await client.rpc("enqueue_curation_job", {
      p_operation: "enrich",
      p_params: { target: "submissions", submissionIds: [randomUUID()] },
      p_dry_run: true,
      p_started_by: "personal-os-integration",
      p_trigger: "admin",
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: "2099-01-01T00:00:00.000Z",
      p_dedupe_key: `personal-os-curation-runs:${randomUUID()}`,
      p_targets: [],
    });

    expect(error).toBeNull();
    expect(jobId).toBeTruthy();
    createdJobIds.add(jobId!);

    const snapshot = await getPersonalOsCurationRuns(1);
    const run = snapshot.runs.find((entry) => entry.id === jobId);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.runs).toHaveLength(1);
    expect(run).toMatchObject({
      id: jobId,
      runner: "curation-worker",
      source: "formoria",
      status: "pending",
      trigger: "admin",
      outcome: { total: 0, succeeded: 0, skipped: 0, failed: 0, cancelled: 0 },
      sourcePath: `/admin/jobs/${jobId}`,
    });
    expect(JSON.stringify(run)).not.toMatch(/params|worker_token|token/i);
  });

  it("returns only runs assigned to the requested inclusive-exclusive window", async () => {
    const client = createTestClient();
    const enqueue = async (suffix: string) => {
      const { data, error } = await client.rpc("enqueue_curation_job", {
        p_operation: "enrich",
        p_params: { target: "submissions", submissionIds: [randomUUID()] },
        p_dry_run: true,
        p_started_by: "personal-os-integration",
        p_trigger: "admin",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: null,
        p_run_after: "2098-01-01T00:00:00.000Z",
        p_dedupe_key: `personal-os-curation-window:${suffix}:${randomUUID()}`,
        p_targets: [],
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      createdJobIds.add(data!);
      return data!;
    };
    const insideId = await enqueue("inside");
    const adjacentId = await enqueue("adjacent");
    const [insideUpdate, adjacentUpdate] = await Promise.all([
      client
        .from("curation_jobs")
        .update({ started_at: "2098-01-01T12:00:00.000Z" })
        .eq("id", insideId),
      client
        .from("curation_jobs")
        .update({ started_at: "2098-01-02T00:00:00.000Z" })
        .eq("id", adjacentId),
    ]);
    expect(insideUpdate.error).toBeNull();
    expect(adjacentUpdate.error).toBeNull();

    const window = {
      start: "2098-01-01T00:00:00.000Z",
      end: "2098-01-02T00:00:00.000Z",
    };
    const snapshot = await getPersonalOsCurationRuns(undefined, window);

    expect(snapshot.window).toEqual(window);
    expect(snapshot.runs.some((run) => run.id === insideId)).toBe(true);
    expect(snapshot.runs.some((run) => run.id === adjacentId)).toBe(false);
  });
});
