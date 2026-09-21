import type { OperatorMap } from "./types";

export const CHANNEL_PREFIX = "formoria-";

export function parseOperators(envValue: string): OperatorMap {
  const map: OperatorMap = new Map();
  if (!envValue.trim()) return map;

  for (const entry of envValue.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 1 || colonIdx === trimmed.length - 1) {
      console.warn(`[ops-agent] malformed operator entry, skipping: "${trimmed}"`);
      continue;
    }

    const userId = trimmed.slice(0, colonIdx).trim();
    const email = trimmed.slice(colonIdx + 1).trim();
    if (!userId || !email) {
      console.warn(`[ops-agent] malformed operator entry, skipping: "${trimmed}"`);
      continue;
    }

    map.set(userId, email);
  }

  return map;
}

type GuardEnv = {
  OPS_AGENT?: string;
  OPS_AGENT_OPERATORS?: string;
};

export type GuardInput = {
  env: GuardEnv;
  slackUserId: string;
  channelName: string | null;
};

export type GuardResult =
  | { ok: true; operatorEmail: string }
  | { ok: false; reason: "off" | "not_operator" | "wrong_channel" };

/**
 * Checks kill switch, operator allowlist, and channel prefix.
 * The bot only responds in channels whose name starts with "formoria-".
 */
export function evaluateGuards(input: GuardInput): GuardResult {
  if (input.env.OPS_AGENT !== "on") {
    return { ok: false, reason: "off" };
  }

  const operators = parseOperators(input.env.OPS_AGENT_OPERATORS ?? "");
  const operatorEmail = operators.get(input.slackUserId);
  if (!operatorEmail) {
    return { ok: false, reason: "not_operator" };
  }

  if (!input.channelName || !input.channelName.startsWith(CHANNEL_PREFIX)) {
    return { ok: false, reason: "wrong_channel" };
  }

  return { ok: true, operatorEmail };
}

export function isReadonlySelect(sql: string): boolean {
  if (sql.length > 4000) return false;

  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/;\s*$/, "");

  if (!/^\s*select\b/i.test(stripped)) return false;

  if (stripped.includes(";")) return false;

  return true;
}
