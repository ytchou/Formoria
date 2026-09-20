import { auditedCall } from "@/lib/audit";

const TIMEOUT_MS = 30_000;

type FireRoutineParams = {
  routineId: string;
  text: string;
};

type FireRoutineResult = {
  sessionUrl: string;
};

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  return key;
}

export async function fireRoutine(
  params: FireRoutineParams,
): Promise<FireRoutineResult> {
  const apiKey = getApiKey();

  return auditedCall(
    { provider: "anthropic", operation: "fire_routine", kind: "external" },
    async () => {
      const url = `https://api.anthropic.com/v1/claude_code/routines/${params.routineId}/fire`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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

      const data = (await response.json()) as { session_url: string };
      return { sessionUrl: data.session_url };
    },
  );
}
