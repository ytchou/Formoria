import { randomUUID } from "node:crypto";

import { AgentHubReportError, normalizeAgentRunEnvelope } from "./envelope.mjs";
import { redactAgentHubAudit } from "./writer.mjs";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

function requiredString(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new AgentHubSupabaseError(`${field} is invalid`, null, {
      code: "agent_hub_configuration",
    });
  }
  return value;
}

function responseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1_000) };
  }
}

function isSuccessfulResult(response, body) {
  return (
    response.ok &&
    isRecord(body) &&
    typeof body.duplicate === "boolean" &&
    typeof body.run_id === "string"
  );
}

function auditRecord(
  { attempt, latencyMs, request, response, status },
  secrets,
) {
  return {
    attempt,
    destination: "supabase",
    event: "agent_hub_write",
    latency_ms: latencyMs,
    operation: "ingest_envelope",
    request: redactAgentHubAudit(request, secrets),
    response: redactAgentHubAudit(response, secrets),
    status,
    success: status === "success",
  };
}

/**
 * @typedef {Object} SupabaseAgentRunOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {typeof fetch} [fetchImplementation]
 * @property {(record: Record<string, unknown>) => unknown} [logger]
 * @property {number} [maxAttempts]
 * @property {boolean} [normalizeInput]
 * @property {string[]} [secrets]
 * @property {(milliseconds: number) => Promise<unknown>} [sleep]
 * @property {number} [timeoutMs]
 * @property {string} [token]
 * @property {string} [url]
 */

export class AgentHubSupabaseError extends AgentHubReportError {
  constructor(
    message,
    status = null,
    { code = "supabase_write_failed", cause } = {},
  ) {
    super(message, status);
    this.name = "AgentHubSupabaseError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export async function writeSupabaseAgentRun(
  input,
  /** @type {SupabaseAgentRunOptions} */
  {
    env = process.env,
    fetchImplementation = fetch,
    logger = (record) => console.log(JSON.stringify(record)),
    maxAttempts = 3,
    normalizeInput = true,
    secrets = [],
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = 15_000,
    token,
    url,
  } = {},
) {
  const payload = normalizeInput ? normalizeAgentRunEnvelope(input) : input;
  const endpoint = requiredString(
    url ?? env.AGENT_HUB_INGEST_URL,
    "AGENT_HUB_INGEST_URL",
    2_048,
  );
  const authToken = requiredString(
    token ?? env.AGENT_HUB_INGEST_TOKEN,
    "AGENT_HUB_INGEST_TOKEN",
    1_000,
  );
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new AgentHubSupabaseError("maxAttempts is invalid", null, {
      code: "agent_hub_configuration",
    });
  }
  const auditSecrets = [...secrets, authToken];
  const request = { envelope: payload, method: "POST", url: endpoint };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      const response = await fetchImplementation(endpoint, {
        body: JSON.stringify(payload),
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json",
          "x-request-id": randomUUID(),
        },
        method: "POST",
        signal:
          typeof AbortSignal?.timeout === "function"
            ? AbortSignal.timeout(timeoutMs)
            : undefined,
      });
      const body = responseBody(await response.text());
      const valid = isSuccessfulResult(response, body);
      logger(
        auditRecord(
          {
            attempt,
            latencyMs: Math.round(performance.now() - startedAt),
            request,
            response: {
              http_status: response.status,
              result: body,
            },
            status: valid ? "success" : "failure",
          },
          auditSecrets,
        ),
      );
      if (valid) return body;

      if (shouldRetry(response.status) && attempt < maxAttempts) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }

      const message =
        isRecord(body) && typeof body.error === "string"
          ? redactAgentHubAudit(body.error, auditSecrets)
          : "Supabase Agent Hub rejected the run";
      throw new AgentHubSupabaseError(message, response.status);
    } catch (error) {
      if (error instanceof AgentHubSupabaseError) throw error;
      logger(
        auditRecord(
          {
            attempt,
            latencyMs: Math.round(performance.now() - startedAt),
            request,
            response: { error: "request_failed" },
            status: "failure",
          },
          auditSecrets,
        ),
      );
      if (attempt === maxAttempts) {
        throw new AgentHubSupabaseError(
          "Supabase Agent Hub request failed",
          null,
          {
            cause: error,
          },
        );
      }
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  throw new AgentHubSupabaseError("Supabase Agent Hub request failed");
}

export function createSupabaseAgentHubWriter(options = {}) {
  return (input) =>
    writeSupabaseAgentRun(input, {
      ...options,
      normalizeInput: false,
    });
}
