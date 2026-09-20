/**
 * Repo worker HTTP service.
 *
 * Accepts repair jobs from the health agent, clones the repository, runs
 * commands and optionally invokes the configured agent, then returns changed files.
 *
 * No database, no Supabase imports — the repo worker is a pure compute node.
 * It imports from worker-boot for health paths and crash handlers only (NOT
 * the database assertion).
 *
 * No timers: the server creates no setInterval or setTimeout while idle.
 * Per-command kill timers live in jobs.ts.
 */

import { timingSafeEqual, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { execFile, spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeJobError } from "@/lib/services/job-errors";
import type { AgentRequest, AgentResult } from "./agent";
import { runCodexAgent } from "./codex";
import { isRepoWorkerHealthPath } from "./health-paths";
import { runRepoJob, type JobResult, type JobDeps } from "./jobs";
import { bootWorker, logWorkerBuildInfo } from "@/worker-boot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunRequest = {
  ref: string;
  cloneToken: string;
  commands: { id: string; run: string; timeoutMs: number }[];
  inputFiles?: { path: string; content: string }[];
  agent?: AgentRequest;
  claude?: {
    prompt: string;
    allowedTools: string[];
    maxTurns: number;
    jsonSchema: object;
    resumeSessionId?: string;
  };
  editableFiles: string[];
  blockedFiles?: string[];
};

type JobEntry = {
  id: string;
  status: "running" | "done" | "failed";
  result?: JobResult;
};

// ---------------------------------------------------------------------------
// DI seams for createRepoWorkerServer
// ---------------------------------------------------------------------------

export type ServerOptions = {
  /** Bearer token for auth. Omit or undefined to disable auth. */
  token?: string;
  /** Override the clone function (for tests). */
  cloneFn?: (args: string[]) => Promise<string>;
  /** Override the Git subprocess executor (for tests). */
  gitExecFn?: (args: string[]) => Promise<{
    stderr: string;
    exitCode: number | null;
  }>;
  /** Override the command runner (for tests). */
  runCommandFn?: (
    dir: string,
    command: string,
    timeoutMs: number,
  ) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  }>;
  /** Override the cleanup function (for tests). */
  cleanupFn?: (dir: string) => Promise<void>;
  /** Override the active agent executor (for tests). */
  agentFn?: (dir: string, request: AgentRequest) => Promise<AgentResult>;
  /** Override the dedicated Codex credential (for tests). */
  codexApiKey?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 512 * 1024; // 512 KB — repair payloads can be large

export function runGitForClone(
  args: string[],
): Promise<{ stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = execFile("git", args, { timeout: 120_000 });
    const stderrChunks: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer | string) =>
      stderrChunks.push(chunk.toString()),
    );
    proc.on("close", (exitCode) => {
      resolve({
        stderr: stderrChunks.join(""),
        exitCode,
      });
    });
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the repo-worker HTTP server. Exported for testability — the module's
 * top-level boot code calls this with real implementations.
 */
export function createRepoWorkerServer(opts: ServerOptions = {}) {
  const { token } = opts;
  const jobs = new Map<string, JobEntry>();
  let activeJobId: string | null = null;

  // Real implementations (overridable by tests)
  const gitExecFn =
    opts.gitExecFn ??
    runGitForClone;

  const cloneFn =
    opts.cloneFn ??
    (async (args: string[]): Promise<string> => {
      const dir = await mkdtemp(path.join(tmpdir(), "repo-worker-"));
      args.push(dir);
      const { stderr, exitCode } = await gitExecFn(args);
      if (exitCode !== 0) {
        const details = sanitizeJobError(stderr.trim(), 1_000);
        throw new Error(
          details
            ? `git clone exited with ${exitCode}: ${details}`
            : `git clone exited with ${exitCode}`,
        );
      }
      return dir;
    });

  const runCommandFn =
    opts.runCommandFn ??
    (async (
      dir: string,
      command: string,
      timeoutMs: number,
    ): Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      timedOut: boolean;
    }> => {
      return new Promise((resolve) => {
        const proc = spawn("sh", ["-c", command], {
          cwd: dir,
          timeout: timeoutMs,
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        proc.stdout.on("data", (d: Buffer) => stdoutChunks.push(d));
        proc.stderr.on("data", (d: Buffer) => stderrChunks.push(d));
        proc.on("close", (code, signal) => {
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            exitCode: code ?? 1,
            timedOut: signal === "SIGTERM",
          });
        });
        proc.on("error", (err) => {
          resolve({
            stdout: "",
            stderr: err.message,
            exitCode: 1,
            timedOut: false,
          });
        });
      });
    });

  const cleanupFn =
    opts.cleanupFn ??
    (async (dir: string) => {
      await rm(dir, { recursive: true, force: true });
    });

  const codexApiKey = opts.codexApiKey ?? process.env.CODEX_API_KEY ?? "";
  const agentFn =
    opts.agentFn ??
    (codexApiKey
      ? (dir: string, request: AgentRequest) =>
          runCodexAgent(dir, request, { apiKey: codexApiKey })
      : undefined);

  // -----------------------------------------------------------------------
  // HTTP server
  // -----------------------------------------------------------------------

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Worker request failed" });
      }
      console.error("[repo-worker]", error);
    });
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    // Health checks (no auth required)
    if (request.method === "GET" && isRepoWorkerHealthPath(request.url)) {
      sendJson(response, 200, { ok: true });
      return;
    }

    // Auth (only when token is configured) — protects all non-health endpoints
    if (token && !isAuthorized(request.headers.authorization, token)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    // GET /jobs/:id
    if (request.method === "GET" && request.url?.startsWith("/jobs/")) {
      const jobId = request.url.slice("/jobs/".length);
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: "Unknown job" });
        return;
      }
      const body: Record<string, unknown> = { status: job.status };
      if (job.result) {
        if (job.result.results) body.results = job.result.results;
        if (job.result.changedFiles)
          body.changedFiles = job.result.changedFiles;
        if (job.result.revertedFiles)
          body.revertedFiles = job.result.revertedFiles;
        if (job.result.baseSha) body.baseSha = job.result.baseSha;
        if (job.result.agent) body.agent = job.result.agent;
        if (job.result.claude) body.claude = job.result.claude;
        if (job.result.error) body.error = job.result.error;
        if (job.result.errorStage) body.errorStage = job.result.errorStage;
        if (job.result.errorCode) body.errorCode = job.result.errorCode;
      }
      sendJson(response, 200, body);
      return;
    }

    // POST /run
    if (request.method !== "POST" || request.url !== "/run") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    // Parse body
    let body: RunRequest;
    try {
      body = (await readJson(request)) as RunRequest;
    } catch (error) {
      const status = error instanceof BodyTooLargeError ? 413 : 400;
      sendJson(response, status, {
        error: error instanceof Error ? error.message : "Bad request",
      });
      return;
    }

    // Reject if a job is already running
    if (activeJobId !== null) {
      sendJson(response, 409, { error: "A job is already running" });
      return;
    }

    // Accept the job
    const jobId = randomUUID();
    const entry: JobEntry = { id: jobId, status: "running" };
    jobs.set(jobId, entry);
    activeJobId = jobId;

    sendJson(response, 202, { jobId });

    // Run the job asynchronously
    void (async () => {
      let cloneDir: string | undefined;
      try {
        const deps: JobDeps = {
          async cloneFn(args) {
            cloneDir = await cloneFn(args);
            return cloneDir;
          },
          runCommandFn,
          cleanupFn,
          agentFn,
          async readFileFn(filePath: string) {
            if (!cloneDir) return null;
            try {
              const target = await resolveExistingRepoPath(cloneDir, filePath);
              return await readFile(target, "utf8");
            } catch (error) {
              if (isMissingFileError(error)) return null;
              throw error;
            }
          },
          async writeFileFn(filePath: string, content: string) {
            if (!cloneDir) {
              throw new Error("Clone directory is unavailable");
            }
            const target = resolveRepoPath(cloneDir, filePath);
            await assertNoSymlinkComponents(cloneDir, path.dirname(target));
            await mkdir(path.dirname(target), { recursive: true });
            await assertRealPathInsideClone(cloneDir, path.dirname(target));
            try {
              if ((await lstat(target)).isSymbolicLink()) {
                throw new Error(`Repository path is a symbolic link: ${filePath}`);
              }
            } catch (error) {
              if (!isMissingFileError(error)) throw error;
            }
            await writeFile(target, content, "utf8");
          },
          async listChangedFilesFn() {
            if (!cloneDir) return [];
            const result = await execGit(cloneDir, [
              "ls-files",
              "-z",
              "--modified",
              "--deleted",
              "--others",
              "--exclude-standard",
            ]);
            if (result.exitCode !== 0) {
              throw new Error(`git ls-files exited with ${result.exitCode}`);
            }
            return result.stdout.split("\0").filter(Boolean);
          },
          async listDeletedFilesFn() {
            if (!cloneDir) return [];
            const result = await execGit(cloneDir, [
              "ls-files",
              "-z",
              "--deleted",
            ]);
            if (result.exitCode !== 0) {
              throw new Error(
                `git ls-files --deleted exited with ${result.exitCode}`,
              );
            }
            return result.stdout.split("\0").filter(Boolean);
          },
          async getHeadShaFn() {
            if (!cloneDir) return "unknown";
            const result = await execGit(cloneDir, ["rev-parse", "HEAD"]);
            if (result.exitCode !== 0) {
              throw new Error(`git rev-parse exited with ${result.exitCode}`);
            }
            return result.stdout.trim();
          },
          async revertFileFn(repoDir, filePath) {
            const tracked = await execGit(repoDir, [
              "ls-files",
              "--error-unmatch",
              "--",
              filePath,
            ]);
            if (tracked.exitCode === 0) {
              const restored = await execGit(repoDir, [
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                filePath,
              ]);
              if (restored.exitCode !== 0) {
                throw new Error(`git restore exited with ${restored.exitCode}`);
              }
              return;
            }
            await rm(resolveRepoPath(repoDir, filePath), { force: true });
          },
        };

        const result = await runRepoJob(body, deps);
        entry.status = result.status;
        entry.result = result;
      } catch (error) {
        entry.status = "failed";
        entry.result = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          errorStage: "worker",
          errorCode: "worker-failed",
        };
      } finally {
        activeJobId = null;
      }
    })();
  }

  return server;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "BodyTooLargeError";
  }
}

function isAuthorized(value: string | undefined, expected: string): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  const received = Buffer.from(value.slice("Bearer ".length));
  const expectedBuffer = Buffer.from(expected);
  return (
    received.length === expectedBuffer.length &&
    timingSafeEqual(received, expectedBuffer)
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function resolveRepoPath(repoDir: string, filePath: string): string {
  const resolvedRoot = path.resolve(repoDir);
  const resolved = path.resolve(resolvedRoot, filePath);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Repository path escapes clone: ${filePath}`);
  }
  return resolved;
}

async function resolveExistingRepoPath(
  repoDir: string,
  filePath: string,
): Promise<string> {
  const lexicalPath = resolveRepoPath(repoDir, filePath);
  if ((await lstat(lexicalPath)).isSymbolicLink()) {
    throw new Error(`Repository path is a symbolic link: ${filePath}`);
  }
  await assertRealPathInsideClone(repoDir, lexicalPath);
  return lexicalPath;
}

async function assertRealPathInsideClone(
  repoDir: string,
  candidate: string,
): Promise<void> {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(repoDir),
    realpath(candidate),
  ]);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Repository path resolves outside clone: ${candidate}`);
  }
}

async function assertNoSymlinkComponents(
  repoDir: string,
  candidateDirectory: string,
): Promise<void> {
  const relative = path.relative(path.resolve(repoDir), candidateDirectory);
  let current = path.resolve(repoDir);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Repository directory is a symbolic link: ${current}`);
      }
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function execGit(
  repoDir: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd: repoDir, timeout: 120_000 });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout?.on("data", (chunk: Buffer | string) =>
      stdout.push(chunk.toString()),
    );
    child.stderr?.on("data", (chunk: Buffer | string) =>
      stderr.push(chunk.toString()),
    );
    child.on("close", (exitCode) =>
      resolve({
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        exitCode,
      }),
    );
    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Standalone boot (when run via `tsx src/repo-worker/server.ts`)
// ---------------------------------------------------------------------------

const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("repo-worker/server.ts") ||
    process.argv[1].endsWith("repo-worker/server.js"));

if (isMainModule) {
  await bootWorker({
    agent: "repo-worker",
    // No assertTarget — the repo worker has no database to verify.
    // No loadServices — all code is statically imported above.
  });

  const port = parsePort(process.env.PORT);
  const token = process.env.REPO_WORKER_TOKEN?.trim() || undefined;

  const server = createRepoWorkerServer({ token });
  server.listen(port, "0.0.0.0", () => {
    logWorkerBuildInfo("repo-worker");
    console.log(`[repo-worker] listening on port ${port}`);
    if (token) {
      console.log("[repo-worker] bearer auth enabled");
    } else {
      console.log("[repo-worker] bearer auth disabled (no REPO_WORKER_TOKEN)");
    }
  });
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "8080", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536
    ? parsed
    : 8080;
}
