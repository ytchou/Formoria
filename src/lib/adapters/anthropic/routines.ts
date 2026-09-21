import { auditedCall } from "@/lib/audit";

const TIMEOUT_MS = 30_000;

type FireRoutineParams = {
  routineId: string;
  text: string;
};

type FireRoutineResult = {
  sessionUrl: string;
};

function getRoutineToken(): string {
  const key = process.env.OPS_ROUTINE_TOKEN;
  if (!key) throw new Error("OPS_ROUTINE_TOKEN is not set");
  return key;
}

export async function fireRoutine(
  params: FireRoutineParams,
): Promise<FireRoutineResult> {
  const token = getRoutineToken();

  return auditedCall(
    { provider: "anthropic", operation: "fire_routine", kind: "external" },
    async () => {
      const url = `https://api.anthropic.com/v1/claude_code/routines/${params.routineId}/fire`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: params.text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Routines API error (${response.status}): ${body}`,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      const sessionUrl = data.claude_code_session_url;
      if (typeof sessionUrl !== "string") {
        throw new Error(
          `Routines API returned no claude_code_session_url (keys: ${Object.keys(data).join(", ")})`,
        );
      }
      return { sessionUrl };
    },
  );
}
