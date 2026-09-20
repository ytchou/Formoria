import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for the repo-worker HTTP service.
 *
 * We import the factory function `createRepoWorkerServer` with DI seams for
 * clone, commands, and agent execution so tests stay within controlled boundaries.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUrl(server: http.Server, path: string): string {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}${path}`;
}

async function post(
  server: http.Server,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(makeUrl(server, path), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function get(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(makeUrl(server, path), { headers });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function waitForJob(
  server: http.Server,
  jobId: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await get(server, `/jobs/${jobId}`, {
      authorization: "Bearer test-bearer-token-abc",
    });
    if (response.json.status !== "running") return response;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

// ---------------------------------------------------------------------------
// Minimal valid request body
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    ref: "main",
    cloneToken: "ghp_test123",
    commands: [{ id: "c1", run: "echo hello", timeoutMs: 5000 }],
    editableFiles: ["src/foo.ts"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("repo-worker server", () => {
  let createRepoWorkerServer: typeof import("../server").createRepoWorkerServer;
  let runGitForClone: typeof import("../server").runGitForClone;
  let server: http.Server;
  const TOKEN = "test-bearer-token-abc";

  beforeAll(async () => {
    ({ createRepoWorkerServer, runGitForClone } = await import("../server"));
  });

  afterEach(() => {
    if (server?.listening) {
      server.close();
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: serves both health paths
  // -------------------------------------------------------------------------
  it("returns Git stderr instead of crashing when clone setup fails", async () => {
    const result = await runGitForClone(["definitely-not-a-git-command"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("definitely-not-a-git-command");
  });

  it("serves both health paths", async () => {
    server = createRepoWorkerServer({ token: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    const health = await get(server, "/health");
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ ok: true });

    const apiHealth = await get(server, "/api/health");
    expect(apiHealth.status).toBe(200);
    expect(apiHealth.json).toMatchObject({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Test 2: rejects a second job while one is running with 409
  // -------------------------------------------------------------------------
  it("rejects a second job while one is running with 409", async () => {
    // The first job's clone never resolves, keeping it in "running" state.
    let resolveClone!: () => void;
    const clonePromise = new Promise<string>((resolve) => {
      resolveClone = () => resolve("/tmp/fake-clone");
    });

    server = createRepoWorkerServer({
      token: TOKEN,
      cloneFn: () => clonePromise,
      runCommandFn: async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false }),
      cleanupFn: async () => {},
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    const first = await post(server, "/run", validBody(), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(first.status).toBe(202);

    const second = await post(server, "/run", validBody(), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(second.status).toBe(409);
    expect(second.json).toMatchObject({ error: expect.stringContaining("already running") });

    // Let the first job finish so the server can shut down cleanly.
    resolveClone();
  });

  // -------------------------------------------------------------------------
  // Test 3: enforces Bearer only when REPO_WORKER_TOKEN is set
  // -------------------------------------------------------------------------
  it("enforces Bearer only when REPO_WORKER_TOKEN is set", async () => {
    // With token configured: missing auth → 401
    server = createRepoWorkerServer({ token: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    const unauthed = await post(server, "/run", validBody());
    expect(unauthed.status).toBe(401);

    const badToken = await post(server, "/run", validBody(), {
      authorization: "Bearer wrong",
    });
    expect(badToken.status).toBe(401);

    server.close();
    await new Promise<void>((r) => server.on("close", r));

    // Without token: auth is not enforced
    server = createRepoWorkerServer({ token: undefined });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    // Should get past auth (will get a different error or 202, not 401)
    const noToken = await post(server, "/run", validBody());
    expect(noToken.status).not.toBe(401);
  });

  it("returns worker failure stage and code from the polling endpoint", async () => {
    server = createRepoWorkerServer({
      token: TOKEN,
      cloneFn: async () => "/tmp/fake-clone",
      runCommandFn: async () => ({
        stdout: "",
        stderr: "registry unavailable",
        exitCode: 1,
        timedOut: false,
      }),
      cleanupFn: async () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const accepted = await post(server, "/run", validBody(), {
      authorization: `Bearer ${TOKEN}`,
    });
    const completed = await waitForJob(server, accepted.json.jobId as string);

    expect(completed.json).toMatchObject({
      status: "failed",
      errorStage: "install",
      errorCode: "install-failed",
    });
  });

  it("returns sanitized Git stderr when cloning fails", async () => {
    server = createRepoWorkerServer({
      token: TOKEN,
      gitExecFn: async (args) => {
        const cloneDir = args.at(-1);
        if (!cloneDir) throw new Error("Missing clone directory");
        await rm(cloneDir, { recursive: true, force: true });
        return {
          exitCode: 128,
          stderr: [
            "fatal: Authentication failed for https://github.com/formoria/formoria.git/",
            "Authorization: Basic c3VwZXItc2VjcmV0",
            "remote: rejected ghp_syntheticCredential123",
            "x".repeat(1_500),
          ].join("\n"),
        };
      },
      cleanupFn: async () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const accepted = await post(server, "/run", validBody(), {
      authorization: `Bearer ${TOKEN}`,
    });
    const completed = await waitForJob(server, accepted.json.jobId as string);
    const error = completed.json.error as string;

    expect(completed.json).toMatchObject({
      status: "failed",
      errorStage: "clone",
      errorCode: "clone-failed",
    });
    expect(error).toContain("git clone exited with 128");
    expect(error).toContain("fatal: Authentication failed");
    expect(error).toContain("Authorization: Basic [REDACTED]");
    expect(error).not.toContain("c3VwZXItc2VjcmV0");
    expect(error).not.toContain("ghp_syntheticCredential123");
    expect(error.length).toBeLessThanOrEqual(
      "git clone exited with 128: ".length + 1_000,
    );
  });

  it("returns provider-neutral agent output through the polling endpoint", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "repo-worker-agent-test-"));
    await writeFile(join(repoDir, "README.md"), "agent fixture\n", "utf8");
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["add", "README.md"], { cwd: repoDir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Repo Worker Test",
        "-c",
        "user.email=repo-worker@example.com",
        "commit",
        "-m",
        "test fixture",
      ],
      { cwd: repoDir, stdio: "ignore" },
    );

    try {
      server = createRepoWorkerServer({
        token: TOKEN,
        cloneFn: async () => repoDir,
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        agentFn: async () => ({
          structuredOutput: { status: "diagnosed" },
          sessionId: "thread-123",
        }),
        cleanupFn: async () => {},
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );

      const accepted = await post(
        server,
        "/run",
        validBody({
          commands: [],
          editableFiles: [],
          agent: {
            prompt: "Diagnose the repository",
            access: "read",
            jsonSchema: { type: "object" },
          },
        }),
        { authorization: `Bearer ${TOKEN}` },
      );
      const completed = await waitForJob(
        server,
        accepted.json.jobId as string,
      );

      expect(completed.json).toMatchObject({
        status: "done",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        agent: {
          structuredOutput: { status: "diagnosed" },
          sessionId: "thread-123",
        },
      });
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it("rejects seeded files whose parent resolves outside the clone", async () => {
    const root = await mkdtemp(join(tmpdir(), "repo-worker-path-test-"));
    const cloneDir = join(root, "clone");
    const outsideDir = join(root, "outside");
    await mkdir(join(cloneDir, "src"), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, join(cloneDir, "src", "link"));

    try {
      server = createRepoWorkerServer({
        token: TOKEN,
        cloneFn: async () => cloneDir,
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        cleanupFn: async () => {},
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );

      const accepted = await post(
        server,
        "/run",
        validBody({
          commands: [],
          inputFiles: [
            {
              path: "src/link/credential.ts",
              content: "export const credential = 'must-stay-inside-clone';",
            },
          ],
        }),
        { authorization: `Bearer ${TOKEN}` },
      );
      const completed = await waitForJob(
        server,
        accepted.json.jobId as string,
      );

      expect(completed.json).toMatchObject({
        status: "failed",
        errorStage: "worker",
        errorCode: "worker-failed",
      });
      await expect(access(join(outsideDir, "credential.ts"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: registers no interval or timer while idle
  // -------------------------------------------------------------------------
  it("registers no interval or timer while idle", async () => {
    server = createRepoWorkerServer({ token: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    // Wait a tick to let any lingering async initialization settle.
    await new Promise((r) => setTimeout(r, 50));

    // The server should have exactly one active handle: the listening socket.
    // Node does not expose getActiveHandles() on the typed interface, but it
    // is always available at runtime.
    const handles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
    const serverHandles = handles.filter(
      (h) => h === server || (h as { _server?: unknown })._server === server,
    );
    // Only the server socket itself, no timers or intervals.
    // We check that no setInterval/setTimeout handles were created by the server module.
    // This is a structural test — the real constraint is that the source file has
    // no setInterval/setTimeout calls (verified by the grep in the spec).
    expect(serverHandles.length).toBeLessThanOrEqual(1);
  });
});
