/**
 * Repo worker job runner.
 *
 * Clones a repository at a given ref, runs commands, optionally invokes an
 * agent, enforces scope, and returns changed file contents.
 *
 * Every I/O operation is behind a DI seam so tests never touch the filesystem.
 * The real implementations live in server.ts which wires them at boot.
 *
 * No database, no Supabase imports — the repo worker is a pure compute node.
 */

import path from "node:path";
import type { AgentRequest, AgentResult } from "./agent";
import type { ClaudeOptions, ClaudeResult } from "./claude";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Command = {
  id: string;
  run: string;
  timeoutMs: number;
};

export type CommandResult = {
  id: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

export type ChangedFile = {
  path: string;
  content: string;
};

export type JobRequest = {
  ref: string;
  cloneToken: string;
  commands: Command[];
  inputFiles?: ChangedFile[];
  agent?: AgentRequest;
  claude?: ClaudeOptions & { oauthToken?: string };
  editableFiles: string[];
  blockedFiles?: string[];
};

export type JobErrorStage = "clone" | "install" | "policy" | "worker";

export type JobResult = {
  status: "done" | "failed";
  results?: CommandResult[];
  changedFiles?: ChangedFile[];
  revertedFiles?: string[];
  baseSha?: string;
  agent?: AgentResult;
  claude?: ClaudeResult;
  error?: string;
  errorStage?: JobErrorStage;
  errorCode?: string;
};

// ---------------------------------------------------------------------------
// DI seams
// ---------------------------------------------------------------------------

export type JobDeps = {
  /** Clone the repo. Receives the git CLI args, returns the clone directory. */
  cloneFn: (args: string[]) => Promise<string>;
  /** Run a shell command in the clone directory. */
  runCommandFn: (
    dir: string,
    command: string,
    timeoutMs: number,
  ) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  }>;
  /** Read a file from the clone (relative path). Returns null if deleted. */
  readFileFn?: (filePath: string) => Promise<string | null>;
  /** Seed a file into the fresh clone before dependency installation. */
  writeFileFn?: (filePath: string, content: string) => Promise<void>;
  /** List files changed since the clone's HEAD. */
  listChangedFilesFn?: () => Promise<string[]>;
  /** List files deleted since the clone's HEAD. */
  listDeletedFilesFn?: () => Promise<string[]>;
  /** Get the HEAD sha of the clone. */
  getHeadShaFn?: () => Promise<string>;
  /** Revert a single file to HEAD. */
  revertFileFn?: (repoDir: string, filePath: string) => Promise<void>;
  /** Cleanup the clone directory. */
  cleanupFn: (dir: string) => Promise<void>;
  /** Run Claude Code CLI. Provided by server.ts. */
  claudeFn?: (
    dir: string,
    opts: ClaudeOptions & { oauthToken?: string },
  ) => Promise<ClaudeResult>;
  /** Run the active provider-neutral agent. Provided by server.ts. */
  agentFn?: (dir: string, request: AgentRequest) => Promise<AgentResult>;
};

// ---------------------------------------------------------------------------
// Test-file guard patterns
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const SKIP_PATTERN = /\b(describe|it|test)\s*\.\s*skip\b/;
const INSTALL_COMMAND = "NODE_ENV=development pnpm install --frozen-lockfile";
const INSTALL_TIMEOUT_MS = 180_000;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

function isEditableFile(filePath: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) => pattern === filePath || path.matchesGlob(filePath, pattern),
  );
}

function isBlockedFile(filePath: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) => pattern === filePath || path.matchesGlob(filePath, pattern),
  );
}

function isPermittedFile(filePath: string, request: JobRequest): boolean {
  return (
    isEditableFile(filePath, request.editableFiles) &&
    !isBlockedFile(filePath, request.blockedFiles ?? [])
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Execute a repo job: clone → install → run commands → enforce scope → collect
 * changed files.
 *
 * Commands run sequentially. A timed-out command is reported but does not
 * prevent later commands from running.
 */
export async function runRepoJob(
  request: JobRequest,
  deps: JobDeps,
): Promise<JobResult> {
  let cloneDir: string | undefined;
  let errorStage: JobErrorStage = "clone";

  try {
    // -----------------------------------------------------------------------
    // 1. Clone with token as a one-off extraheader (never persisted in config)
    // -----------------------------------------------------------------------
    const repoUrl = `https://github.com/${process.env.GITHUB_REPO ?? "formoria/formoria"}.git`;
    const cloneArgs = [
      "-c",
      `http.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${request.cloneToken}`).toString("base64")}`,
      "clone",
      "--depth",
      "1",
      "--branch",
      request.ref,
      repoUrl,
    ];

    cloneDir = await deps.cloneFn(cloneArgs);

    // -----------------------------------------------------------------------
    // 2. Seed files produced by a prior job into the fresh clone
    // -----------------------------------------------------------------------
    errorStage = "worker";
    for (const file of request.inputFiles ?? []) {
      if (isBlockedFile(file.path, request.blockedFiles ?? [])) {
        return {
          status: "failed",
          error: `Input file is inside a blocked path: ${file.path}`,
          errorStage: "policy",
          errorCode: "input-file-blocked",
        };
      }
      if (!deps.writeFileFn) {
        return {
          status: "failed",
          error: "Input files were provided but no file writer is configured",
          errorStage: "worker",
          errorCode: "input-files-unsupported",
        };
      }
      await deps.writeFileFn(file.path, file.content);
    }

    // -----------------------------------------------------------------------
    // 3. Install dependencies in every fresh clone
    // -----------------------------------------------------------------------
    errorStage = "install";
    const installResult = await deps.runCommandFn(
      cloneDir,
      INSTALL_COMMAND,
      INSTALL_TIMEOUT_MS,
    );
    if (installResult.timedOut || installResult.exitCode !== 0) {
      const details = (installResult.stderr || installResult.stdout)
        .trim()
        .slice(0, 1_000);
      const errorCode = installResult.timedOut
        ? "install-timeout"
        : "install-failed";
      const summary = installResult.timedOut
        ? `Dependency installation timed out after ${INSTALL_TIMEOUT_MS}ms`
        : `Dependency installation failed with exit code ${installResult.exitCode}`;
      return {
        status: "failed",
        error: details ? `${summary}: ${details}` : summary,
        errorStage: "install",
        errorCode,
      };
    }

    // -----------------------------------------------------------------------
    // 4. Run commands sequentially
    // -----------------------------------------------------------------------
    errorStage = "worker";
    const results: CommandResult[] = [];

    for (const cmd of request.commands) {
      const result = await deps.runCommandFn(cloneDir, cmd.run, cmd.timeoutMs);
      results.push({
        id: cmd.id,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    }

    // -----------------------------------------------------------------------
    // 5. Run the requested agent
    // -----------------------------------------------------------------------
    let agentResult: AgentResult | undefined;
    if (request.agent) {
      if (!deps.agentFn) {
        return {
          status: "failed",
          results: results.length > 0 ? results : undefined,
          error: "Agent execution was requested but no executor is configured",
          errorStage: "worker",
          errorCode: "agent-executor-unavailable",
        };
      }
      agentResult = await deps.agentFn(cloneDir, request.agent);
    }

    // Dormant Claude contract retained for rollback until DEV-1819.
    let claudeResult: ClaudeResult | undefined;
    if (request.claude) {
      if (!deps.claudeFn) {
        return {
          status: "failed",
          results: results.length > 0 ? results : undefined,
          error: "Claude execution was requested but no executor is configured",
          errorStage: "worker",
          errorCode: "claude-executor-unavailable",
        };
      }
      claudeResult = await deps.claudeFn(cloneDir, request.claude);
    }

    // -----------------------------------------------------------------------
    // 6. Collect changed files and enforce scope
    // -----------------------------------------------------------------------
    const allChangedFiles = deps.listChangedFilesFn
      ? await deps.listChangedFilesFn()
      : [];
    const deletedFiles = deps.listDeletedFilesFn
      ? await deps.listDeletedFilesFn()
      : [];

    const revertedFiles: string[] = [];

    // Revert files outside scope
    for (const filePath of allChangedFiles) {
      if (!isPermittedFile(filePath, request)) {
        if (deps.revertFileFn) {
          await deps.revertFileFn(cloneDir, filePath);
        }
        revertedFiles.push(filePath);
      }
    }

    // -----------------------------------------------------------------------
    // 7. Deletion/test guard: reject unrepresentable deletions and added .skip
    // -----------------------------------------------------------------------
    errorStage = "policy";
    for (const filePath of deletedFiles) {
      if (isPermittedFile(filePath, request)) {
        const testFile = isTestFile(filePath);
        return {
          status: "failed",
          results,
          error: testFile
            ? `Test file deleted by repair: ${filePath}. Test deletions are not permitted.`
            : `File deleted by repair: ${filePath}. The repo-worker patch contract does not support deletions.`,
          errorStage: "policy",
          errorCode: testFile ? "test-file-deleted" : "file-deletion-unsupported",
          revertedFiles: revertedFiles.length > 0 ? revertedFiles : undefined,
        };
      }
    }

    // Check remaining changed files (after revert) for .skip
    const scopedChangedFiles = allChangedFiles.filter(
      (f) =>
        isPermittedFile(f, request) && !deletedFiles.includes(f),
    );

    for (const filePath of scopedChangedFiles) {
      if (isTestFile(filePath) && deps.readFileFn) {
        const content = await deps.readFileFn(filePath);
        if (content && SKIP_PATTERN.test(content)) {
          return {
            status: "failed",
            results,
            error: `Test file contains .skip after repair: ${filePath}. Adding .skip is not permitted.`,
            errorStage: "policy",
            errorCode: "test-skip-added",
            revertedFiles: revertedFiles.length > 0 ? revertedFiles : undefined,
          };
        }
      }
    }

    // -----------------------------------------------------------------------
    // 8. Read file contents and get base sha
    // -----------------------------------------------------------------------
    errorStage = "worker";
    const changedFiles: ChangedFile[] = [];
    for (const filePath of scopedChangedFiles) {
      if (deps.readFileFn) {
        const content = await deps.readFileFn(filePath);
        if (content !== null) {
          changedFiles.push({ path: filePath, content });
        }
      }
    }

    const baseSha = deps.getHeadShaFn ? await deps.getHeadShaFn() : undefined;

    return {
      status: "done",
      results: results.length > 0 ? results : undefined,
      changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
      revertedFiles: revertedFiles.length > 0 ? revertedFiles : undefined,
      baseSha,
      agent: agentResult,
      claude: claudeResult,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      errorStage,
      errorCode: `${errorStage}-failed`,
    };
  } finally {
    // Always clean up the clone directory
    if (cloneDir) {
      await deps.cleanupFn(cloneDir).catch((e) => {
        console.error("[repo-worker:cleanup]", e);
      });
    }
  }
}
