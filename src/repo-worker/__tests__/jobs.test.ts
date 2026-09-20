import { describe, expect, it, beforeEach } from "vitest";

/**
 * Tests for the repo-worker job runner.
 *
 * All filesystem and process operations are injected via DI seams, so these
 * tests never touch git or spawn processes.
 */

describe("repo-worker jobs", () => {
  let runRepoJob: typeof import("../jobs").runRepoJob;

  beforeEach(async () => {
    ({ runRepoJob } = await import("../jobs"));
  });

  it("installs development dependencies before requested commands", async () => {
    const executed: Array<{ command: string; timeoutMs: number }> = [];

    const result = await runRepoJob(
      {
        ref: "staging",
        cloneToken: "ghp_test",
        commands: [{ id: "vitest", run: "pnpm test", timeoutMs: 300_000 }],
        editableFiles: [],
      },
      {
        cloneFn: async () => "/tmp/fresh-clone",
        runCommandFn: async (_dir, command, timeoutMs) => {
          executed.push({ command, timeoutMs });
          return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
        },
        cleanupFn: async () => {},
      },
    );

    expect(result.status).toBe("done");
    expect(executed).toEqual([
      {
        command: "NODE_ENV=development pnpm install --frozen-lockfile",
        timeoutMs: 180_000,
      },
      { command: "pnpm test", timeoutMs: 300_000 },
    ]);
    expect(result.results?.map((command) => command.id)).toEqual(["vitest"]);
  });

  it("seeds prior patch files before installing and validating a fresh clone", async () => {
    const events: string[] = [];

    const result = await runRepoJob(
      {
        ref: "staging",
        cloneToken: "ghp_test",
        commands: [
          { id: "typecheck", run: "pnpm typecheck", timeoutMs: 120_000 },
        ],
        inputFiles: [
          { path: "src/lib/utils.ts", content: "export const fixed = true;" },
        ],
        editableFiles: [],
      },
      {
        cloneFn: async () => "/tmp/fresh-clone",
        writeFileFn: async (filePath, content) => {
          events.push(`write:${filePath}:${content}`);
        },
        runCommandFn: async (_dir, command) => {
          events.push(`run:${command}`);
          return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
        },
        cleanupFn: async () => {},
      },
    );

    expect(result.status).toBe("done");
    expect(events).toEqual([
      "write:src/lib/utils.ts:export const fixed = true;",
      "run:NODE_ENV=development pnpm install --frozen-lockfile",
      "run:pnpm typecheck",
    ]);
  });

  it.each([
    {
      name: "failure",
      installResult: {
        stdout: "",
        stderr: "ERR_PNPM_FETCH_500 registry unavailable",
        exitCode: 1,
        timedOut: false,
      },
      errorCode: "install-failed",
    },
    {
      name: "timeout",
      installResult: {
        stdout: "",
        stderr: "",
        exitCode: 124,
        timedOut: true,
      },
      errorCode: "install-timeout",
    },
  ])(
    "aborts after install $name and cleans up the clone",
    async ({ installResult, errorCode }) => {
      const executed: string[] = [];
      const cleaned: string[] = [];

      const result = await runRepoJob(
        {
          ref: "staging",
          cloneToken: "ghp_test",
          commands: [{ id: "vitest", run: "pnpm test", timeoutMs: 300_000 }],
          editableFiles: [],
        },
        {
          cloneFn: async () => "/tmp/fresh-clone",
          runCommandFn: async (_dir, command) => {
            executed.push(command);
            return installResult;
          },
          cleanupFn: async (dir) => {
            cleaned.push(dir);
          },
        },
      );

      expect(executed).toEqual([
        "NODE_ENV=development pnpm install --frozen-lockfile",
      ]);
      expect(cleaned).toEqual(["/tmp/fresh-clone"]);
      expect(result).toMatchObject({
        status: "failed",
        errorStage: "install",
        errorCode,
      });
    },
  );

  it("fails explicitly when an agent is requested without an executor", async () => {
    const result = await runRepoJob(
      {
        ref: "staging",
        cloneToken: "ghp_test",
        commands: [],
        editableFiles: [],
        agent: {
          prompt: "Diagnose the failure",
          access: "read",
          jsonSchema: { type: "object" },
        },
      },
      {
        cloneFn: async () => "/tmp/fresh-clone",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        cleanupFn: async () => {},
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      errorStage: "worker",
      errorCode: "agent-executor-unavailable",
    });
  });

  it("returns provider-neutral agent output when the executor is configured", async () => {
    const result = await runRepoJob(
      {
        ref: "staging",
        cloneToken: "ghp_test",
        commands: [],
        editableFiles: [],
        agent: {
          prompt: "Diagnose the failure",
          access: "read",
          jsonSchema: { type: "object" },
        },
      },
      {
        cloneFn: async () => "/tmp/fresh-clone",
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
        listChangedFilesFn: async () => [],
        cleanupFn: async () => {},
      },
    );

    expect(result).toMatchObject({
      status: "done",
      agent: {
        structuredOutput: { status: "diagnosed" },
        sessionId: "thread-123",
      },
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: clone uses the token as a one-off extraheader and .git/config
  //         never contains it
  // -------------------------------------------------------------------------
  it("clone uses the token as a one-off extraheader and .git/config never contains it", async () => {
    const capturedArgs: string[][] = [];

    await runRepoJob(
      {
        ref: "main",
        cloneToken: "ghp_secret_token_123",
        commands: [],
        editableFiles: [],
      },
      {
        cloneFn: async (args: string[]) => {
          capturedArgs.push(args);
          return "/tmp/fake-repo";
        },
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        readFileFn: async () => "",
        listChangedFilesFn: async () => [],
        getHeadShaFn: async () => "abc123",
        cleanupFn: async () => {},
      },
    );

    expect(capturedArgs.length).toBe(1);
    const cloneArgs = capturedArgs[0];

    // The token should appear as a header-based credential, not in the URL
    const extraHeaderArg = cloneArgs.find((a) => a.includes("extraheader"));
    expect(extraHeaderArg).toBeDefined();
    // The token is base64-encoded in the Basic auth header, not in plaintext
    const decoded = Buffer.from(
      extraHeaderArg!.split("Basic ")[1],
      "base64",
    ).toString();
    expect(decoded).toContain("ghp_secret_token_123");

    // The token should not appear as a persisted credential in the clone URL
    const urlArg = cloneArgs.find((a) => a.startsWith("https://"));
    if (urlArg) {
      expect(urlArg).not.toContain("ghp_secret_token_123");
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: edits outside editableFiles are reverted and reported
  // -------------------------------------------------------------------------
  it("edits outside editableFiles are reverted and reported", async () => {
    const revertedFiles: string[] = [];

    const result = await runRepoJob(
      {
        ref: "main",
        cloneToken: "ghp_test",
        commands: [{ id: "c1", run: "echo ok", timeoutMs: 5000 }],
        editableFiles: ["src/allowed.ts"],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        readFileFn: async (filePath: string) => `content of ${filePath}`,
        // After commands run, "git diff" shows both allowed and disallowed files
        listChangedFilesFn: async () => [
          "src/allowed.ts",
          "src/not-allowed.ts",
          "package.json",
        ],
        getHeadShaFn: async () => "abc123",
        cleanupFn: async () => {},
        revertFileFn: async (_repoDir: string, filePath: string) => {
          revertedFiles.push(filePath);
        },
      },
    );

    // Files outside editableFiles were reverted
    expect(revertedFiles).toContain("src/not-allowed.ts");
    expect(revertedFiles).toContain("package.json");
    expect(revertedFiles).not.toContain("src/allowed.ts");

    // Only allowed files appear in changedFiles
    expect(result.changedFiles?.map((f) => f.path)).toEqual(["src/allowed.ts"]);

    // Reverted files are reported
    expect(result.revertedFiles).toContain("src/not-allowed.ts");
    expect(result.revertedFiles).toContain("package.json");
  });

  it("keeps files covered by an editable glob and reverts files outside it", async () => {
    const revertedFiles: string[] = [];
    const result = await runRepoJob(
      {
        ref: "staging",
        cloneToken: "ghp_test",
        commands: [],
        editableFiles: ["e2e/**/*.ts"],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        readFileFn: async (filePath) => `content of ${filePath}`,
        listChangedFilesFn: async () => [
          "e2e/tests/search.spec.ts",
          "src/app/page.tsx",
        ],
        revertFileFn: async (_repoDir, filePath) => {
          revertedFiles.push(filePath);
        },
        cleanupFn: async () => {},
      },
    );

    expect(result.changedFiles).toEqual([
      {
        path: "e2e/tests/search.spec.ts",
        content: "content of e2e/tests/search.spec.ts",
      },
    ]);
    expect(revertedFiles).toEqual(["src/app/page.tsx"]);
  });

  // -------------------------------------------------------------------------
  // Test 8: a patch deleting a test file or adding .skip is rejected
  // -------------------------------------------------------------------------
  it("a patch deleting a test file or adding .skip is rejected", async () => {
    // Case 1: A test file is deleted (appears in changed but read returns null)
    const resultDeleted = await runRepoJob(
      {
        ref: "main",
        cloneToken: "ghp_test",
        commands: [{ id: "c1", run: "echo ok", timeoutMs: 5000 }],
        editableFiles: ["src/foo.test.ts"],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        readFileFn: async () => null,
        listChangedFilesFn: async () => ["src/foo.test.ts"],
        listDeletedFilesFn: async () => ["src/foo.test.ts"],
        getHeadShaFn: async () => "abc123",
        cleanupFn: async () => {},
      },
    );

    expect(resultDeleted.status).toBe("failed");
    expect(resultDeleted.error).toMatch(/test.*delet/i);

    // Case 2: A test file has .skip added
    const resultSkip = await runRepoJob(
      {
        ref: "main",
        cloneToken: "ghp_test",
        commands: [{ id: "c1", run: "echo ok", timeoutMs: 5000 }],
        editableFiles: ["src/foo.test.ts"],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        readFileFn: async () =>
          'describe.skip("my test", () => { it("works", () => {}) });',
        listChangedFilesFn: async () => ["src/foo.test.ts"],
        listDeletedFilesFn: async () => [],
        getHeadShaFn: async () => "abc123",
        cleanupFn: async () => {},
      },
    );

    expect(resultSkip.status).toBe("failed");
    expect(resultSkip.error).toMatch(/\.skip/i);
  });

  it("rejects source-file deletions that cannot be represented in the patch result", async () => {
    const result = await runRepoJob(
      {
        ref: "staging",
        cloneToken: "ghp_test",
        commands: [],
        editableFiles: ["src/obsolete.ts"],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        listChangedFilesFn: async () => ["src/obsolete.ts"],
        listDeletedFilesFn: async () => ["src/obsolete.ts"],
        cleanupFn: async () => {},
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      errorStage: "policy",
      errorCode: "file-deletion-unsupported",
    });
  });

  // -------------------------------------------------------------------------
  // Test 9: a command exceeding its timeout is killed and reported, and later
  //         commands still run
  // -------------------------------------------------------------------------
  it("a command exceeding its timeout is killed and reported, and later commands still run", async () => {
    const executedCommands: string[] = [];

    const result = await runRepoJob(
      {
        ref: "main",
        cloneToken: "ghp_test",
        commands: [
          { id: "slow", run: "sleep 999", timeoutMs: 50 },
          { id: "fast", run: "echo done", timeoutMs: 5000 },
        ],
        editableFiles: [],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async (_dir: string, cmd: string, timeoutMs: number) => {
          executedCommands.push(cmd);
          if (cmd === "sleep 999") {
            // Simulate timeout
            await new Promise((r) => setTimeout(r, timeoutMs + 10));
            return {
              stdout: "",
              stderr: "",
              exitCode: 124,
              timedOut: true,
            };
          }
          return { stdout: "done\n", stderr: "", exitCode: 0, timedOut: false };
        },
        readFileFn: async () => "",
        listChangedFilesFn: async () => [],
        getHeadShaFn: async () => "abc123",
        cleanupFn: async () => {},
      },
    );

    // Both commands were attempted
    expect(executedCommands).toContain("sleep 999");
    expect(executedCommands).toContain("echo done");

    // The timed-out command is reported
    const slowResult = result.results?.find((r) => r.id === "slow");
    expect(slowResult?.timedOut).toBe(true);

    // The later command still succeeded
    const fastResult = result.results?.find((r) => r.id === "fast");
    expect(fastResult?.exitCode).toBe(0);
    expect(fastResult?.timedOut).toBeFalsy();
  });

  // -------------------------------------------------------------------------
  // Test 11: changedFiles returns full file contents and the base sha
  // -------------------------------------------------------------------------
  it("changedFiles returns full file contents and the base sha", async () => {
    const result = await runRepoJob(
      {
        ref: "main",
        cloneToken: "ghp_test",
        commands: [{ id: "c1", run: "echo ok", timeoutMs: 5000 }],
        editableFiles: ["src/fixed.ts", "src/also-fixed.ts"],
      },
      {
        cloneFn: async () => "/tmp/fake-repo",
        runCommandFn: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
        readFileFn: async (filePath) => {
          if (filePath === "src/also-fixed.ts") return "export const y = 2;\n";
          if (filePath === "src/fixed.ts") return "export const x = 1;\n";
          return "";
        },
        listChangedFilesFn: async () => ["src/fixed.ts", "src/also-fixed.ts"],
        getHeadShaFn: async () => "deadbeef1234",
        cleanupFn: async () => {},
      },
    );

    expect(result.status).toBe("done");
    expect(result.baseSha).toBe("deadbeef1234");
    expect(result.changedFiles).toEqual([
      { path: "src/fixed.ts", content: "export const x = 1;\n" },
      { path: "src/also-fixed.ts", content: "export const y = 2;\n" },
    ]);
  });
});
