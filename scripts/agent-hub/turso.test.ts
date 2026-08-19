import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentHubMissingAgentError,
  AgentHubPausedAgentError,
} from "./writer.mjs";
import { createTursoAgentHubWriter } from "./turso.mjs";

const schema = `
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    actions TEXT NOT NULL,
    completed_at TEXT,
    cost_usd REAL,
    created_at TEXT NOT NULL,
    duration_ms INTEGER,
    error TEXT,
    log_url TEXT,
    metadata TEXT NOT NULL,
    model TEXT,
    report_date TEXT,
    run_number INTEGER NOT NULL,
    source_run_id TEXT,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    tokens_input INTEGER,
    tokens_output INTEGER,
    verdict_severity TEXT,
    verdict_text TEXT,
    UNIQUE (agent_id, source_run_id)
  );
`;

const resources: {
  directory: string;
  url: string;
  databases: ReturnType<typeof createClient>[];
}[] = [];

async function fileBackedResource(
  count: number,
  agentStatus = "active",
  seedAgent = true,
) {
  const directory = await mkdtemp(join(tmpdir(), "formoria-agent-hub-"));
  const url = `file:${join(directory, `${randomUUID()}.db`)}`;
  const databases = Array.from({ length: count }, () =>
    createClient({
      timeout: 250,
      url,
    }),
  );

  try {
    const setupDatabase = databases.at(0);
    if (!setupDatabase) throw new Error("at least one database is required");
    await setupDatabase.executeMultiple(schema);
    if (seedAgent) {
      await setupDatabase.execute({
        sql: "INSERT INTO agents (id, name, project, status) VALUES (?, ?, ?, ?)",
        args: ["agent-health", "health-agent", "formoria", agentStatus],
      });
    }
  } catch (error) {
    for (const database of databases) database.close();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }

  const resource = { databases, directory, url };
  resources.push(resource);
  return resource;
}

async function fileBackedDatabases(
  count: number,
  agentStatus = "active",
  seedAgent = true,
) {
  return (await fileBackedResource(count, agentStatus, seedAgent)).databases;
}

async function database(agentStatus = "active") {
  const databases = await fileBackedDatabases(1, agentStatus);
  const database = databases.at(0);
  if (!database) throw new Error("database setup did not create a client");
  return database;
}

async function missingAgentDatabase() {
  const databases = await fileBackedDatabases(1, "active", false);
  const database = databases.at(0);
  if (!database) throw new Error("database setup did not create a client");
  return database;
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      model_usage: {
        cost_usd: 0.42,
        model: "gpt-5.6-luna",
        tokens_input: 120,
        tokens_output: 45,
      },
      scorecard: { sessions: 42 },
    },
    date: "2026-07-15",
    log_url: "https://github.com/ytchou/Formoria/actions/runs/123",
    project: "formoria",
    routine: "health-agent",
    run_at: "2026-07-14T23:10:00.000Z",
    source: "github_actions",
    source_run_id: "github-actions:health-agent:123:1",
    status: "success",
    tickets_created: ["DEV-1234"],
    verdict_severity: "ok",
    verdict_text: "Health is steady.",
    version: 1,
    ...overrides,
  };
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    for (const database of resource.databases) database.close();
    await rm(resource.directory, { force: true, recursive: true });
  }
});

describe("Turso Agent Hub writer", () => {
  it("writes every retained run field, allocates per-agent numbers, and replays safely", async () => {
    const databaseClient = await database();
    const writer = createTursoAgentHubWriter({
      database: databaseClient,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      sleep: () => Promise.resolve(),
      logger: () => undefined,
    });

    const first = await writer(envelope());
    const replay = await writer(envelope());
    const second = await writer(
      envelope({ source_run_id: "github-actions:health-agent:123:2" }),
    );
    const rows = await databaseClient.execute(
      "SELECT * FROM agent_runs ORDER BY run_number",
    );

    expect(first).toMatchObject({
      duplicate: false,
      run_id: expect.any(String),
    });
    expect(replay).toEqual({ duplicate: true, run_id: first.run_id });
    expect(second).toMatchObject({
      duplicate: false,
      run_id: expect.any(String),
    });
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.run_number)).toEqual([1, 2]);

    const row = rows.rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      agent_id: "agent-health",
      completed_at: "2026-07-15T00:00:00.000Z",
      cost_usd: 0.42,
      created_at: "2026-07-15T00:00:00.000Z",
      duration_ms: 3_000_000,
      error: null,
      log_url: "https://github.com/ytchou/Formoria/actions/runs/123",
      model: "gpt-5.6-luna",
      report_date: "2026-07-15",
      run_number: 1,
      source_run_id: "github-actions:health-agent:123:1",
      started_at: "2026-07-14T23:10:00.000Z",
      status: "success",
      summary: "Health is steady.",
      tokens_input: 120,
      tokens_output: 45,
      verdict_severity: "ok",
      verdict_text: "Health is steady.",
    });
    expect(JSON.parse(String(row.actions))).toEqual([
      {
        desc: "Created Linear issue DEV-1234",
        path: "DEV-1234",
        type: "linear_issue",
      },
    ]);
    expect(JSON.parse(String(row.metadata))).toMatchObject({
      model_usage: { cost_usd: 0.42 },
      scorecard: { sessions: 42 },
      source: "github_actions",
    });
  });

  it("rejects missing and paused agents without retrying", async () => {
    const missingClient = await missingAgentDatabase();
    const missingSleeps: number[] = [];
    const missingWriter = createTursoAgentHubWriter({
      database: missingClient,
      sleep: (milliseconds: number) => {
        missingSleeps.push(milliseconds);
        return Promise.resolve();
      },
      logger: () => undefined,
    });

    await expect(
      missingWriter(envelope({ routine: "health-agent" })),
    ).rejects.toBeInstanceOf(AgentHubMissingAgentError);
    expect(missingSleeps).toEqual([]);

    const pausedClient = await database("paused");
    const pausedSleeps: number[] = [];
    const pausedWriter = createTursoAgentHubWriter({
      database: pausedClient,
      sleep: (milliseconds: number) => {
        pausedSleeps.push(milliseconds);
        return Promise.resolve();
      },
      logger: () => undefined,
    });

    await expect(
      pausedWriter(
        envelope({ source_run_id: "github-actions:health-agent:paused" }),
      ),
    ).rejects.toBeInstanceOf(AgentHubPausedAgentError);
    expect(pausedSleeps).toEqual([]);
  });

  it("allocates contiguous numbers across concurrent independent clients", async () => {
    const resource = await fileBackedResource(1);
    const setupDatabase = resource.databases.at(0);
    if (!setupDatabase)
      throw new Error("database setup did not create a client");
    const sourceRunIds = Array.from(
      { length: 12 },
      (_, index) => `github-actions:health-agent:independent:${index + 1}`,
    );
    const writerOptions = {
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      sleep: () => Promise.resolve(),
      logger: () => undefined,
    };
    const writers = [
      createTursoAgentHubWriter({
        authToken: "",
        databaseUrl: resource.url,
        ...writerOptions,
      }),
      createTursoAgentHubWriter({
        authToken: "",
        databaseUrl: resource.url,
        ...writerOptions,
      }),
    ];

    const results: { duplicate: boolean; run_id: string }[] = await Promise.all(
      sourceRunIds.map((sourceRunId, index) =>
        writers[index % writers.length](
          envelope({ source_run_id: sourceRunId }),
        ),
      ),
    );

    expect(results).toHaveLength(sourceRunIds.length);
    expect(results.every((result) => result.duplicate === false)).toBe(true);

    const rows = await setupDatabase.execute(
      "SELECT source_run_id, run_number FROM agent_runs ORDER BY run_number",
    );
    expect(rows.rows).toHaveLength(sourceRunIds.length);
    expect(new Set(rows.rows.map((row) => row.run_number)).size).toBe(
      rows.rows.length,
    );
    expect(rows.rows.map((row) => row.run_number)).toEqual(
      Array.from({ length: sourceRunIds.length }, (_, index) => index + 1),
    );
    expect(new Set(rows.rows.map((row) => row.source_run_id))).toEqual(
      new Set(sourceRunIds),
    );
  });

  it("replays one persisted run for concurrent same-source calls", async () => {
    const resource = await fileBackedResource(1);
    const setupDatabase = resource.databases.at(0);
    if (!setupDatabase)
      throw new Error("database setup did not create a client");
    const writerOptions = {
      authToken: "",
      databaseUrl: resource.url,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      sleep: () => Promise.resolve(),
      logger: () => undefined,
    };
    const writers = [
      createTursoAgentHubWriter(writerOptions),
      createTursoAgentHubWriter(writerOptions),
    ];
    const sourceRunId = "github-actions:health-agent:duplicate";

    const results: { duplicate: boolean; run_id: string }[] = await Promise.all(
      [
        writers[0](envelope({ source_run_id: sourceRunId })),
        writers[1](envelope({ source_run_id: sourceRunId })),
      ],
    );
    const insertedResult = results.find((result) => !result.duplicate);
    const duplicateResult = results.find((result) => result.duplicate);
    if (!insertedResult || !duplicateResult) {
      throw new Error(
        "concurrent duplicate calls must have one insert and one replay",
      );
    }

    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(duplicateResult.run_id).toBe(insertedResult.run_id);

    const rows = await setupDatabase.execute({
      sql: "SELECT id FROM agent_runs WHERE source_run_id = ?",
      args: [sourceRunId],
    });
    expect(rows.rows).toHaveLength(1);
    const persistedRow = rows.rows.at(0);
    if (!persistedRow) throw new Error("duplicate run was not persisted");
    expect(persistedRow.id).toBe(insertedResult.run_id);
  });

  it("continues with a valid write after a queued operation fails", async () => {
    const resource = await fileBackedResource(1, "active", false);
    const setupDatabase = resource.databases.at(0);
    if (!setupDatabase)
      throw new Error("database setup did not create a client");
    const writerOptions = {
      authToken: "",
      databaseUrl: resource.url,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      sleep: () => Promise.resolve(),
      logger: () => undefined,
    };
    const failedWriter = createTursoAgentHubWriter(writerOptions);
    const validWriter = createTursoAgentHubWriter(writerOptions);

    await expect(
      failedWriter(
        envelope({ source_run_id: "github-actions:health-agent:failed" }),
      ),
    ).rejects.toBeInstanceOf(AgentHubMissingAgentError);

    await setupDatabase.execute({
      sql: "INSERT INTO agents (id, name, project, status) VALUES (?, ?, ?, ?)",
      args: ["agent-health", "health-agent", "formoria", "active"],
    });
    const result = await validWriter(
      envelope({ source_run_id: "github-actions:health-agent:recovered" }),
    );

    expect(result).toMatchObject({
      duplicate: false,
      run_id: expect.any(String),
    });
    const rows = await setupDatabase.execute(
      "SELECT run_number FROM agent_runs ORDER BY run_number",
    );
    expect(rows.rows.map((row) => row.run_number)).toEqual([1]);
  });
});
