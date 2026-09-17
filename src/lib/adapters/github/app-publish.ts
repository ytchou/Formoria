import { auditedCall } from "@/lib/audit";
import { getInstallationToken, GitHubAppError } from "./app-auth";

const TIMEOUT_MS = 15_000;
const GITHUB_API = "https://api.github.com";

type PublishFile = {
  path: string;
  content: string;
};

export type PublishInput = {
  baseSha: string;
  files: PublishFile[];
  branch: string;
  title: string;
  body: string;
  labels: string[];
  allowedPaths: string[];
  dryRun?: boolean;
};

export type PublishResult =
  | { ok: true; prUrl: string; prNumber: number }
  | { ok: true; dryRun: true }
  | { ok: false; error: GitHubAppError };

export type PublishDeps = {
  /** DI seam for testing — bypasses real GitHub App auth. */
  getToken?: () => Promise<string>;
};

function getRepo(): string {
  return process.env.GITHUB_APP_REPOSITORY ?? "ytchou/Formoria";
}

/**
 * Audited fetch wrapper for GitHub REST API calls.
 * Throws GitHubAppError on non-2xx responses.
 */
async function githubApi<T>(
  token: string,
  method: string,
  path: string,
  body: unknown,
  operation: string,
): Promise<T> {
  return auditedCall(
    { provider: "github-app", operation, kind: "external" },
    async () => {
      const response = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new GitHubAppError(response.status, text);
      }

      return (await response.json()) as T;
    },
  );
}

/**
 * Publish changed files to a new branch and open a pull request.
 *
 * This adapter contains no business logic — it takes a fully formed
 * list of files and metadata and translates them into the GitHub Git
 * Data API sequence: blobs → tree → commit → ref → PR → labels.
 *
 * Auto-merge is never enabled; a human must approve and merge.
 */
export async function publish(
  input: PublishInput,
  deps?: PublishDeps,
): Promise<PublishResult> {
  // Validate all files against the allowlist before doing anything.
  for (const file of input.files) {
    if (!input.allowedPaths.some((p) => file.path.startsWith(p))) {
      throw new Error(
        `File "${file.path}" is outside the allowed paths: ${input.allowedPaths.join(", ")}`,
      );
    }
  }

  if (input.dryRun) {
    return { ok: true, dryRun: true };
  }

  const token = deps?.getToken
    ? await deps.getToken()
    : await getInstallationToken("publish");
  const repo = getRepo();

  try {
    // 1. Create blobs — one per file
    const blobShas = await Promise.all(
      input.files.map(async (file) => {
        const data = await githubApi<{ sha: string }>(
          token,
          "POST",
          `/repos/${repo}/git/blobs`,
          { content: file.content, encoding: "utf-8" },
          "create_blob",
        );
        return { path: file.path, sha: data.sha };
      }),
    );

    // 2. Create tree on the base sha
    const treeData = await githubApi<{ sha: string }>(
      token,
      "POST",
      `/repos/${repo}/git/trees`,
      {
        base_tree: input.baseSha,
        tree: blobShas.map((b) => ({
          path: b.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: b.sha,
        })),
      },
      "create_tree",
    );

    // 3. Create commit with parent = base sha
    const commitData = await githubApi<{ sha: string }>(
      token,
      "POST",
      `/repos/${repo}/git/commits`,
      {
        message: input.title,
        tree: treeData.sha,
        parents: [input.baseSha],
      },
      "create_commit",
    );

    // 4. Create branch ref
    await githubApi<{ ref: string }>(
      token,
      "POST",
      `/repos/${repo}/git/refs`,
      { ref: `refs/heads/${input.branch}`, sha: commitData.sha },
      "create_branch",
    );

    // 5. Create pull request — auto-merge is intentionally omitted
    const prData = await githubApi<{
      html_url: string;
      number: number;
    }>(
      token,
      "POST",
      `/repos/${repo}/pulls`,
      {
        title: input.title,
        body: input.body,
        head: input.branch,
        base: "staging",
      },
      "create_pull_request",
    );

    // 6. Add labels (PRs are issues in GitHub's API)
    if (input.labels.length > 0) {
      await githubApi<unknown>(
        token,
        "POST",
        `/repos/${repo}/issues/${prData.number}/labels`,
        { labels: input.labels },
        "add_labels",
      );
    }

    return { ok: true, prUrl: prData.html_url, prNumber: prData.number };
  } catch (error) {
    if (error instanceof GitHubAppError) {
      return { ok: false, error };
    }
    throw error;
  }
}
