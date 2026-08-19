import { AgentHubReportError, normalizeAgentRunEnvelope } from "./envelope.mjs";
import { createSupabaseAgentHubWriter } from "./supabase.mjs";
import { createTursoAgentHubWriter } from "./turso.mjs";
import { redactAgentHubAudit } from "./writer.mjs";

export const AGENT_HUB_DELIVERY_MODES = Object.freeze(["dual", "turso"]);
export const AGENT_HUB_PRIMARY_DESTINATION = "supabase";

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

function validateResult(destination, result, sourceRunId) {
  if (
    !isRecord(result) ||
    typeof result.duplicate !== "boolean" ||
    typeof result.run_id !== "string"
  ) {
    throw new AgentHubDeliveryError(
      `${destination} returned an invalid Agent Hub result`,
      { failures: [destination] },
    );
  }
  if (
    result.source_run_id !== undefined &&
    result.source_run_id !== sourceRunId
  ) {
    throw new AgentHubDeliveryError(
      `${destination} returned a mismatched source_run_id`,
      { failures: [destination] },
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

export class AgentHubDeliveryConfigurationError extends AgentHubReportError {
  constructor(message) {
    super(message);
    this.name = "AgentHubDeliveryConfigurationError";
    this.code = "agent_hub_delivery_configuration";
  }
}

export class AgentHubDeliveryError extends AgentHubReportError {
  constructor(message, { mode = null, failures = [], outcomes = {} } = {}) {
    super(message);
    this.name = "AgentHubDeliveryError";
    this.code = "agent_hub_delivery_failed";
    this.mode = mode;
    this.failures = failures;
    this.outcomes = outcomes;
  }
}

/**
 * @param {string | undefined} mode
 * @param {Record<string, string | undefined>} [environment]
 */
export function resolveAgentHubDeliveryMode(mode, environment = process.env) {
  const value = mode ?? environment.AGENT_HUB_DELIVERY_MODE;
  if (!AGENT_HUB_DELIVERY_MODES.includes(value)) {
    throw new AgentHubDeliveryConfigurationError(
      "AGENT_HUB_DELIVERY_MODE must be exactly dual or turso",
    );
  }
  return value;
}

/** @param {Record<string, any>} [options] */
export function createAgentHubDelivery({
  env = process.env,
  logger = (record) => console.log(JSON.stringify(record)),
  mode,
  secrets = [],
  supabaseOptions = {},
  supabaseWriter,
  tursoOptions = {},
  tursoWriter,
} = {}) {
  const deliveryMode = resolveAgentHubDeliveryMode(mode, env);
  const auditSecrets = [
    ...secrets,
    env.AGENT_HUB_INGEST_TOKEN,
    env.AGENT_HUB_TURSO_AUTH_TOKEN,
    supabaseOptions.token,
    tursoOptions.authToken,
  ].filter(Boolean);
  let resolvedSupabaseWriter = supabaseWriter;
  let resolvedTursoWriter = tursoWriter;

  const destinationWriter = (destination) => {
    if (destination === "supabase") {
      resolvedSupabaseWriter ??= createSupabaseAgentHubWriter({
        ...supabaseOptions,
        env,
        logger: (record) => logSafely(logger, record, auditSecrets),
        secrets: auditSecrets,
      });
      return resolvedSupabaseWriter;
    }
    resolvedTursoWriter ??= createTursoAgentHubWriter({
      ...tursoOptions,
      env,
      logger: (record) => logSafely(logger, record, auditSecrets),
      secrets: auditSecrets,
      normalizeInput: false,
    });
    return resolvedTursoWriter;
  };

  return async (input) => {
    const envelope = normalizeAgentRunEnvelope(input);
    const destinations =
      deliveryMode === "dual" ? ["supabase", "turso"] : ["turso"];
    const settled = await Promise.allSettled(
      destinations.map((destination) =>
        Promise.resolve().then(() => destinationWriter(destination)(envelope)),
      ),
    );
    const outcomes = {};
    const failures = [];

    for (const [index, destination] of destinations.entries()) {
      const result = settled[index];
      if (!result) {
        failures.push(destination);
        outcomes[destination] = {
          error: "destination_result_missing",
          status: "failure",
        };
        logSafely(
          logger,
          {
            destination,
            error: "destination_result_missing",
            event: "agent_hub_delivery_destination",
            mode: deliveryMode,
            operation: "deliver",
            source_run_id: envelope.source_run_id,
            status: "failure",
          },
          auditSecrets,
        );
        continue;
      }
      if (result.status === "fulfilled") {
        try {
          const validated = validateResult(
            destination,
            result.value,
            envelope.source_run_id,
          );
          outcomes[destination] = {
            result: validated,
            status: "success",
          };
          logSafely(
            logger,
            {
              destination,
              event: "agent_hub_delivery_destination",
              mode: deliveryMode,
              operation: "deliver",
              response: resultSummary(validated),
              source_run_id: envelope.source_run_id,
              status: "success",
            },
            auditSecrets,
          );
        } catch (error) {
          failures.push(destination);
          outcomes[destination] = {
            error: safeErrorMessage(error, auditSecrets),
            status: "failure",
          };
          logSafely(
            logger,
            {
              destination,
              error: safeErrorMessage(error, auditSecrets),
              event: "agent_hub_delivery_destination",
              mode: deliveryMode,
              operation: "deliver",
              source_run_id: envelope.source_run_id,
              status: "failure",
            },
            auditSecrets,
          );
        }
      } else {
        failures.push(destination);
        outcomes[destination] = {
          error: safeErrorMessage(result.reason, auditSecrets),
          status: "failure",
        };
        logSafely(
          logger,
          {
            destination,
            error: safeErrorMessage(result.reason, auditSecrets),
            event: "agent_hub_delivery_destination",
            mode: deliveryMode,
            operation: "deliver",
            source_run_id: envelope.source_run_id,
            status: "failure",
          },
          auditSecrets,
        );
      }
    }

    if (failures.length > 0) {
      throw new AgentHubDeliveryError(
        `Agent Hub delivery failed for: ${failures.join(", ")}`,
        { failures, mode: deliveryMode, outcomes },
      );
    }

    const primary = outcomes[AGENT_HUB_PRIMARY_DESTINATION];
    const successfulResult =
      deliveryMode === "dual" ? primary?.result : outcomes.turso?.result;
    if (!successfulResult) {
      throw new AgentHubDeliveryError("Agent Hub delivery produced no result", {
        mode: deliveryMode,
        outcomes,
      });
    }
    if (deliveryMode === "turso") return successfulResult;
    return {
      ...successfulResult,
      delivery_mode: deliveryMode,
      destinations: Object.fromEntries(
        Object.entries(outcomes).map(([destination, outcome]) => [
          destination,
          {
            duplicate: outcome.result?.duplicate ?? null,
            status: outcome.status,
          },
        ]),
      ),
      primary_destination: AGENT_HUB_PRIMARY_DESTINATION,
    };
  };
}
