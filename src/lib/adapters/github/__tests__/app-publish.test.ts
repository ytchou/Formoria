import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
} from "@/lib/audit";
import { publish } from "../app-publish";
import { GitHubAppError } from "../app-auth";

const fakeGetToken = () => Promise.resolve("ghs_test_token");

beforeEach(() => {
  setAuditWriteSeam(async () => null);
  vi.stubEnv("GITHUB_APP_REPOSITORY", "ytchou/Formoria");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockGitHubApi(): ReturnType<typeof vi.fn> {
  let blobIndex = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/git/blobs")) {
        blobIndex++;
        return Response.json({ sha: `blob-sha-${blobIndex}` });
      }
      if (url.includes("/git/trees")) {
        return Response.json({ sha: "tree-sha-1" });
      }
      if (url.includes("/git/commits")) {
        return Response.json({ sha: "commit-sha-1" });
      }
      if (url.includes("/git/refs")) {
        return Response.json({ ref: "refs/heads/health-agent/run-123" });
      }
      if (url.includes("/issues/")) {
        return Response.json([{ id: 1, name: "health-agent" }]);
      }
      if (url.includes("/pulls")) {
        return Response.json({
          html_url: "https://github.com/ytchou/Formoria/pull/42",
          number: 42,
        });
      }
      throw new Error(`Unexpected URL in mock: ${url}`);
    });
}

describe("publish", () => {
  it("creates blobs, a tree on the base sha, a commit, a branch and a PR with auto-merge never enabled", async () => {
    const fetchMock = mockGitHubApi();

    const result = await publish(
      {
        baseSha: "base-sha-abc",
        files: [
          { path: "src/health/fix.ts", content: "// fix" },
          { path: "src/health/another.ts", content: "// another" },
        ],
        branch: "health-agent/run-123",
        title: "fix: health agent findings",
        body: "Automated fix",
        labels: ["health-agent"],
        allowedPaths: ["src/health/"],
      },
      { getToken: fakeGetToken },
    );

    expect(result).toEqual({
      ok: true,
      prUrl: "https://github.com/ytchou/Formoria/pull/42",
      prNumber: 42,
    });

    // --- Blobs: one per file ---
    const blobCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/git/blobs"),
    );
    expect(blobCalls).toHaveLength(2);

    // --- Tree: references base sha ---
    const treeCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/git/trees"),
    );
    expect(treeCalls).toHaveLength(1);
    const treeBody = JSON.parse(treeCalls[0]![1]!.body as string);
    expect(treeBody.base_tree).toBe("base-sha-abc");
    expect(treeBody.tree).toHaveLength(2);

    // --- Commit: parent is base sha ---
    const commitCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/git/commits"),
    );
    expect(commitCalls).toHaveLength(1);
    const commitBody = JSON.parse(commitCalls[0]![1]!.body as string);
    expect(commitBody.parents).toEqual(["base-sha-abc"]);
    expect(commitBody.tree).toBe("tree-sha-1");

    // --- Branch ref ---
    const refCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/git/refs"),
    );
    expect(refCalls).toHaveLength(1);
    const refBody = JSON.parse(refCalls[0]![1]!.body as string);
    expect(refBody.ref).toBe("refs/heads/health-agent/run-123");
    expect(refBody.sha).toBe("commit-sha-1");

    // --- PR: base is staging, no auto-merge ---
    const prCalls = fetchMock.mock.calls.filter(([u]) => {
      const s = String(u);
      return s.includes("/pulls") && !s.includes("/issues/");
    });
    expect(prCalls).toHaveLength(1);
    const prBody = JSON.parse(prCalls[0]![1]!.body as string);
    expect(prBody.base).toBe("staging");
    expect(prBody.head).toBe("health-agent/run-123");
    expect(prBody).not.toHaveProperty("auto_merge");
    expect(prBody).not.toHaveProperty("merge_method");
  });

  it("refuses a changed file outside the allowlist it is given", async () => {
    await expect(
      publish(
        {
          baseSha: "base-sha-abc",
          files: [{ path: "dangerous/hack.ts", content: "// bad" }],
          branch: "health-agent/run-456",
          title: "bad PR",
          body: "nope",
          labels: [],
          allowedPaths: ["src/health/"],
        },
        { getToken: fakeGetToken },
      ),
    ).rejects.toThrow(/outside the allowed paths/);
  });

  it("is a no-op in dryRun", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await publish(
      {
        baseSha: "base-sha-abc",
        files: [{ path: "src/health/fix.ts", content: "// fix" }],
        branch: "health-agent/run-789",
        title: "dry run",
        body: "testing",
        labels: ["health-agent"],
        allowedPaths: ["src/health/"],
        dryRun: true,
      },
      { getToken: fakeGetToken },
    );

    expect(result).toEqual({ ok: true, dryRun: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 401 from GitHub surfaces as a typed error, not a thrown fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad credentials", { status: 401 }),
    );

    const result = await publish(
      {
        baseSha: "base-sha-abc",
        files: [{ path: "src/health/fix.ts", content: "// fix" }],
        branch: "health-agent/run-401",
        title: "will fail",
        body: "auth fail",
        labels: [],
        allowedPaths: ["src/health/"],
      },
      { getToken: fakeGetToken },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(GitHubAppError);
      expect(result.error.status).toBe(401);
    }
  });
});
