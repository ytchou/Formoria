import type { OperatorMap } from "./types";

// ---------------------------------------------------------------------------
// Operator parsing
// ---------------------------------------------------------------------------

/**
 * Parses `"U1:a@x.com,U2:b@x.com"` into a Map<slackUserId, operatorEmail>.
 * Malformed entries (missing colon, empty parts) are dropped with a console warning.
 */
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

// ---------------------------------------------------------------------------
// Guard evaluation
// ---------------------------------------------------------------------------

export type GuardEnv = {
  OPS_AGENT?: string;
  OPS_AGENT_OPERATORS?: string;
};

export type GuardInput = {
  env: GuardEnv;
  slackUserId: string;
};

export type GuardResult =
  | { ok: true; operatorEmail: string }
  | { ok: false; reason: "off" | "not_operator" };

/**
 * Checks kill switch and operator allowlist.
 * The bot responds in any channel the operator mentions it from —
 * the operator allowlist is the access control.
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

  return { ok: true, operatorEmail };
}

// ---------------------------------------------------------------------------
// SQL guard
// ---------------------------------------------------------------------------

/**
 * Returns true only if `sql` is a single SELECT statement under the length cap.
 * Rejects multi-statement (`;`), non-SELECT, and oversized queries.
 */
export function isReadonlySelect(sql: string): boolean {
  if (sql.length > 4000) return false;

  // Strip SQL comments before checking
  const stripped = sql
    .replace(/--[^\n]*/g, "")   // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments

  // Must start with SELECT (case-insensitive)
  if (!/^\s*select\b/i.test(stripped)) return false;

  // No semicolons in the stripped content (prevents multi-statement).
  // Known limitation: this rejects semicolons inside SQL string literals
  // (e.g. WHERE col = 'a;b'). This is acceptable as defense-in-depth;
  // the DB function ops_agent_readonly_query enforces the real constraint.
  if (stripped.includes(";")) return false;

  return true;
}
