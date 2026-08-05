import { runWithAuditContext } from "./context";

/**
 * Opens exactly one ambient audit scope per invocation and is otherwise
 * transparent: same arguments, same return value, same thrown errors.
 */
export function withAuditScope<A extends unknown[], R>(
  handler: (...args: A) => R,
): (...args: A) => R {
  return (...args: A) => runWithAuditContext({}, () => handler(...args));
}
