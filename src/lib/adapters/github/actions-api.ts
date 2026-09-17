import { auditedCall } from "@/lib/audit";

const GITHUB_REPO = "ytchou/Formoria";
export const WORKFLOW_ALLOWLIST = [
  "e2e-staging.yml",
  "ops-fix.yml",
] as const;

const TIMEOUT_MS = 8_000;
const API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;

export type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  headBranch: string;
};

function getHeaders(): Record<string, string> {
  const token = process.env.OPS_AGENT_GITHUB_TOKEN;
  if (!token) throw new Error("OPS_AGENT_GITHUB_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function listWorkflowRuns(
  workflowFile: string,
  perPage = 10,
): Promise<WorkflowRun[]> {
  return auditedCall(
    { provider: "github", operation: "list_workflow_runs", kind: "external" },
    async () => {
      const url = `${API_BASE}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${perPage}`;
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        workflow_runs: Array<{
          id: number;
          status: string;
          conclusion: string | null;
          html_url: string;
          created_at: string;
          head_branch: string;
        }>;
      };

      return data.workflow_runs.map((run) => ({
        id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
        createdAt: run.created_at,
        headBranch: run.head_branch,
      }));
    },
  );
}

export async function dispatchWorkflow(
  workflowFile: string,
  inputs?: Record<string, string>,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const allowed = (WORKFLOW_ALLOWLIST as readonly string[]).includes(
    workflowFile,
  );
  if (!allowed) {
    throw new Error(
      `Workflow "${workflowFile}" is not in allowlist: ${WORKFLOW_ALLOWLIST.join(", ")}`,
    );
  }

  return auditedCall(
    { provider: "github", operation: "dispatch_workflow", kind: "external" },
    async () => {
      const url = `${API_BASE}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...getHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "staging", inputs: inputs ?? {} }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 204 || response.ok) {
        return { ok: true as const };
      }
      return { ok: false as const, status: response.status };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}
