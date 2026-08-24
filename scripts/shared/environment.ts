/**
 * Shared environment-variable accessor for operator scripts.
 *
 * `requiredEnvironment` was copied byte-for-byte into
 * `scripts/spend-watch/report.ts`, `scripts/health-agent/workflow-runtime.ts`,
 * `scripts/notifications/e2e-slack.ts` and `scripts/production-probe/probe.ts`.
 * This module is the canonical home; the other three keep their copies until
 * someone touches them for an unrelated reason, because rewriting a script's
 * failure path is not a change worth bundling into an unrelated diff.
 *
 * The module depends on nothing but the type it declares, so importing it
 * cannot couple two otherwise-independent operator scripts.
 */

export type ScriptEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Reads a required variable, throwing an error whose `name` carries the missing
 * variable. Callers log `error.name`, so the Actions log names the variable
 * without printing any value.
 */
export function requiredEnvironment(
  environment: ScriptEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value) return value;
  const error = new Error(`${name} is required`);
  error.name = `MissingEnvironment:${name}`;
  throw error;
}
