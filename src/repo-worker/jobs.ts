/**
 * Repo worker job runner.
 *
 * Clones a repository at a given ref, runs commands, optionally invokes
 * Claude Code, enforces scope, and returns changed file contents.
 *
 * Every I/O operation is behind a DI seam so tests never touch the filesystem.
 * The real implementations live in server.ts which wires them at boot.
 *
 * No database, no Supabase imports — the repo worker is a pure compute node.
 */

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
  claude?: ClaudeOptions & { oauthToken?: string };
  editableFiles: string[];
};

export type JobResult = {
  status: "done" | "failed";
  results?: CommandResult[];
  changedFiles?: ChangedFile[];
  revertedFiles?: string[];
  baseSha?: string;
  claude?: ClaudeResult;
  error?: string;
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
};

// ---------------------------------------------------------------------------
// Test-file guard patterns
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const SKIP_PATTERN =
  /\b(describe|it|test)\s*\.\s*skip\b/;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
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
    // 2. Run commands sequentially
    // -----------------------------------------------------------------------
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
    // 3. Run Claude Code if requested
    // -----------------------------------------------------------------------
    let claudeResult: ClaudeResult | undefined;
    if (request.claude && deps.claudeFn) {
      claudeResult = await deps.claudeFn(cloneDir, request.claude);
    }

    // -----------------------------------------------------------------------
    // 4. Collect changed files and enforce scope
    // -----------------------------------------------------------------------
    const allChangedFiles = deps.listChangedFilesFn
      ? await deps.listChangedFilesFn()
      : [];
    const deletedFiles = deps.listDeletedFilesFn
      ? await deps.listDeletedFilesFn()
      : [];

    const allowedSet = new Set(request.editableFiles);
    const revertedFiles: string[] = [];

    // Revert files outside scope
    for (const filePath of allChangedFiles) {
      if (!allowedSet.has(filePath)) {
        if (deps.revertFileFn) {
          await deps.revertFileFn(cloneDir, filePath);
        }
        revertedFiles.push(filePath);
      }
    }

    // -----------------------------------------------------------------------
    // 5. Test-file guard: reject patches that delete test files or add .skip
    // -----------------------------------------------------------------------
    for (const filePath of deletedFiles) {
      if (isTestFile(filePath) && allowedSet.has(filePath)) {
        return {
          status: "failed",
          results,
          error: `Test file deleted by repair: ${filePath}. Test deletions are not permitted.`,
          revertedFiles: revertedFiles.length > 0 ? revertedFiles : undefined,
        };
      }
    }

    // Check remaining changed files (after revert) for .skip
    const scopedChangedFiles = allChangedFiles.filter(
      (f) => allowedSet.has(f) && !deletedFiles.includes(f),
    );

    for (const filePath of scopedChangedFiles) {
      if (isTestFile(filePath) && deps.readFileFn) {
        const content = await deps.readFileFn(filePath);
        if (content && SKIP_PATTERN.test(content)) {
          return {
            status: "failed",
            results,
            error: `Test file contains .skip after repair: ${filePath}. Adding .skip is not permitted.`,
            revertedFiles: revertedFiles.length > 0 ? revertedFiles : undefined,
          };
        }
      }
    }

    // -----------------------------------------------------------------------
    // 6. Read file contents and get base sha
    // -----------------------------------------------------------------------
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
      claude: claudeResult,
    };
  } catch (error) {
    return {
      status: "failed",
      error:
        error instanceof Error ? error.message : String(error),
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
