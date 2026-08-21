import { AgentHubReportError, normalizeAgentRunEnvelope } from "./envelope.mjs";
import { createTursoAgentHubWriter } from "./turso.mjs";
import { redactAgentHubAudit } from "./writer.mjs";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeErrorMessage(error, secrets) {
  return redactAgentHubAudit(
    error instanceof Error ? error.message : error,
    secrets,
  );
}

function resultSummary(result) {
  return {
    duplicate: result.duplicate,
    run_id_present: typeof result.run_id === "string",
  };
}

function validateResult(result, sourceRunId) {
  if (
    !isRecord(result) ||
    typeof result.duplicate !== "boolean" ||
    typeof result.run_id !== "string"
  ) {
    throw new AgentHubDeliveryError(
      "turso returned an invalid Agent Hub result",
      { failures: ["turso"] },
    );
  }
  if (
    result.source_run_id !== undefined &&
    result.source_run_id !== sourceRunId
  ) {
    throw new AgentHubDeliveryError(
      "turso returned a mismatched source_run_id",
      { failures: ["turso"] },
    );
  }
  return result;
}

function logSafely(logger, record, secrets) {
  try {
    logger(redactAgentHubAudit(record, secrets));
  } catch {
    // Audit failure must not hide the destination result.
  }
}

export class AgentHubDeliveryError extends AgentHubReportError {
  constructor(message, { failures = [], outcomes = {} } = {}) {
    super(message);
    this.name = "AgentHubDeliveryError";
    this.code = "agent_hub_delivery_failed";
    this.failures = failures;
    this.outcomes = outcomes;
  }
}

/** @param {Record<string, any>} [options] */
export function createAgentHubDelivery({
  env = process.env,
  logger = (record) => console.log(JSON.stringify(record)),
  secrets = [],
  tursoOptions = {},
  tursoWriter,
} = {}) {
  const auditSecrets = [
    ...secrets,
    env.AGENT_HUB_TURSO_AUTH_TOKEN,
    tursoOptions.authToken,
  ].filter(Boolean);
  let writer = tursoWriter;
  const resolveWriter = () =>
    (writer ??= createTursoAgentHubWriter({
      ...tursoOptions,
      env,
      logger: (record) => logSafely(logger, record, auditSecrets),
      secrets: auditSecrets,
      normalizeInput: false,
    }));

  return async (input) => {
    const envelope = normalizeAgentRunEnvelope(input);
    try {
      const result = validateResult(
        await resolveWriter()(envelope),
        envelope.source_run_id,
      );
      logSafely(
        logger,
        {
          destination: "turso",
          event: "agent_hub_delivery_destination",
          operation: "deliver",
          response: resultSummary(result),
          source_run_id: envelope.source_run_id,
          status: "success",
        },
        auditSecrets,
      );
      return result;
    } catch (error) {
      const errorMessage = safeErrorMessage(error, auditSecrets);
      const outcomes = {
        turso: {
          error: errorMessage,
          status: "failure",
        },
      };
      logSafely(
        logger,
        {
          destination: "turso",
          error: errorMessage,
          event: "agent_hub_delivery_destination",
          operation: "deliver",
          source_run_id: envelope.source_run_id,
          status: "failure",
        },
        auditSecrets,
      );
      throw new AgentHubDeliveryError(
        "Agent Hub delivery failed for: turso",
        {
          failures: ["turso"],
          outcomes,
        },
      );
    }
  };
}
