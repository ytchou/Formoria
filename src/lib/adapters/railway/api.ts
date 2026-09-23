import { auditedCall } from "@/lib/audit";

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const TIMEOUT_MS = 8_000;

const E2E_NIGHTLY_ENVIRONMENT_ID = "cb8f8b37-b99f-4c88-9f83-e5d969d3cfd4";
const E2E_NIGHTLY_SERVICE_NAME = "e2e-nightly-agent";

const SERVICE_INSTANCES_QUERY = `query($id: String!) {
  environment(id: $id) {
    serviceInstances { edges { node { id serviceName } } }
  }
}`;

// Railway's "Run now": starts one execution of a cron service. A redeploy
// only rebuilds the service and never runs the scheduled job.
const RUN_NOW_MUTATION = `mutation($input: DeploymentInstanceExecutionCreateInput!) {
  deploymentInstanceExecutionCreate(input: $input)
}`;

type PostResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<PostResult<T>> {
  const response = await fetch(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    return { ok: false, error: `Railway API error: ${response.status}` };
  }

  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (body.errors?.length) {
    return { ok: false, error: body.errors.map((e) => e.message).join("; ") };
  }

  return { ok: true, data: body.data as T };
}

export async function runE2eAgentNow(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const token = process.env.OPS_AGENT_RAILWAY_TOKEN;
  if (!token) throw new Error("OPS_AGENT_RAILWAY_TOKEN is not set");

  return auditedCall(
    {
      provider: "railway",
      operation: "run_cron_now",
      kind: "external",
      meta: {
        serviceName: E2E_NIGHTLY_SERVICE_NAME,
        environmentId: E2E_NIGHTLY_ENVIRONMENT_ID,
      },
    },
    async (ctx) => {
      const lookup = await post<{
        environment?: {
          serviceInstances?: {
            edges?: Array<{ node: { id: string; serviceName: string } }>;
          };
        };
      }>(token, SERVICE_INSTANCES_QUERY, { id: E2E_NIGHTLY_ENVIRONMENT_ID });
      if (!lookup.ok) return { ok: false as const, error: lookup.error };

      const instance = lookup.data?.environment?.serviceInstances?.edges?.find(
        (edge) => edge.node.serviceName === E2E_NIGHTLY_SERVICE_NAME,
      )?.node;
      if (!instance) {
        return {
          ok: false as const,
          error: `Railway service ${E2E_NIGHTLY_SERVICE_NAME} not found in environment ${E2E_NIGHTLY_ENVIRONMENT_ID}`,
        };
      }
      ctx.summary.serviceInstanceId = instance.id;

      const run = await post<{ deploymentInstanceExecutionCreate?: boolean }>(
        token,
        RUN_NOW_MUTATION,
        { input: { serviceInstanceId: instance.id } },
      );
      if (!run.ok) return { ok: false as const, error: run.error };
      if (run.data?.deploymentInstanceExecutionCreate !== true) {
        return {
          ok: false as const,
          error: "Railway refused to start the e2e-nightly-agent execution",
        };
      }

      return { ok: true as const };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}
