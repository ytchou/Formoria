import { auditedCall } from "@/lib/audit";

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.app/graphql";
const TIMEOUT_MS = 8_000;

const E2E_NIGHTLY_SERVICE_ID = "6c4f9c22-8d6c-4d6a-a5c1-5b26428d144f";
const E2E_NIGHTLY_ENVIRONMENT_ID = "cb8f8b37-b99f-4c88-9f83-e5d969d3cfd4";

export async function redeployE2eAgent(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const token = process.env.OPS_AGENT_RAILWAY_TOKEN;
  if (!token) throw new Error("OPS_AGENT_RAILWAY_TOKEN is not set");

  return auditedCall(
    { provider: "railway", operation: "redeploy_service", kind: "external" },
    async () => {
      const response = await fetch(RAILWAY_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `mutation { serviceInstanceRedeploy(serviceId: "${E2E_NIGHTLY_SERVICE_ID}", environmentId: "${E2E_NIGHTLY_ENVIRONMENT_ID}") }`,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          ok: false as const,
          error: `Railway API error: ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        data?: { serviceInstanceRedeploy: boolean };
        errors?: Array<{ message: string }>;
      };

      if (data.errors?.length) {
        return {
          ok: false as const,
          error: data.errors.map((e) => e.message).join("; "),
        };
      }

      return { ok: true as const };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}
