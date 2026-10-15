/** True for a plain non-null, non-array object, narrowed to a string-keyed record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
