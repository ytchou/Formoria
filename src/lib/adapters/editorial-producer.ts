import { auditedCall } from "@/lib/audit";
import { normalizeBaseUrl } from "./internal-http";
import type {
  CommandInput,
  StartInput,
} from "@/lib/services/editorial-producer/types";

export type ProducerResult =
  | {
      ok: true;
      runId: string;
      status: string;
      stage: string;
      costUsd: number;
      costUncertain: boolean;
      question: { text: string } | null;
      deliveryError: string | null;
    }
  | { ok: false; error: string };
async function dispatch(
  path: string,
  input: StartInput | CommandInput,
): Promise<ProducerResult> {
  const base = normalizeBaseUrl(process.env.EDITORIAL_PRODUCER_URL);
  const token = process.env.EDITORIAL_PRODUCER_TOKEN;
  if (!base || !token)
    return { ok: false, error: "Editorial Producer is not configured" };
  return auditedCall(
    { provider: "editorial-producer", operation: "dispatch", kind: "external" },
    async (ctx) => {
      ctx.summary.request = { path, input };
      const attempts: unknown[] = [];
      ctx.summary.attempts = attempts;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt)
          await new Promise((done) => setTimeout(done, attempt * 1000));
        const started = Date.now();
        try {
          const response = await fetch(base + path, {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(20_000),
            redirect: "error",
          });
          if ([502, 503, 504].includes(response.status) && attempt < 2) {
            attempts.push({
              attempt,
              status: response.status,
              latencyMs: Date.now() - started,
              response: await response.text(),
            });
            continue;
          }
          const data = (await response.json()) as {
            runId?: string;
            status?: string;
            stage?: string;
            costUsd?: number;
            costUncertain?: boolean;
            question?: { text: string } | null;
            deliveryError?: string | null;
            error?: string;
          };
          attempts.push({
            attempt,
            status: response.status,
            latencyMs: Date.now() - started,
            response: data,
          });
          if (!response.ok)
            return {
              ok: false,
              error:
                response.status === 409
                  ? "Another editorial run is unfinished (" +
                    (data.status ?? "busy") +
                    "). Finish or cancel it before starting another."
                  : (data.error ?? "Editorial worker request failed"),
            };
          if (
            !data.runId ||
            !data.status ||
            !data.stage ||
            typeof data.costUsd !== "number" ||
            !Number.isFinite(data.costUsd) ||
            typeof data.costUncertain !== "boolean"
          )
            return { ok: false, error: "Malformed editorial worker response" };
          return {
            ok: true,
            runId: data.runId,
            status: data.status,
            stage: data.stage,
            costUsd: data.costUsd,
            costUncertain: data.costUncertain,
            question: data.question ?? null,
            deliveryError: data.deliveryError ?? null,
          };
        } catch {
          attempts.push({
            attempt,
            status: "network_or_invalid_response",
            latencyMs: Date.now() - started,
          });
          if (attempt === 2)
            return {
              ok: false,
              error:
                "Editorial worker unavailable; retry the same request to avoid duplicate starts",
            };
        }
      }
      return { ok: false, error: "Editorial worker unavailable" };
    },
    { classify: (result) => (result.ok ? "succeeded" : "failed") },
  );
}
export function startEditorialProducer(
  input: StartInput,
): Promise<ProducerResult> {
  return dispatch("/runs/start", input);
}
export function commandEditorialProducer(
  input: CommandInput,
): Promise<ProducerResult> {
  return dispatch("/runs/command", input);
}
