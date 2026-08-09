export type FailedState = { status: string; failedTests: string[] };

export function validateCollectedIds(
  state: FailedState,
  collectedIds: string[],
) {
  const collected = new Set(collectedIds);
  const missing = state.failedTests.filter((id) => !collected.has(id));
  if (missing.length) {
    throw new Error(
      `Stored Playwright test IDs are no longer collectible: ${missing.join(", ")}`,
    );
  }
  return state.failedTests.length;
}

export function nextTargetedAttempt(current: number, maximum = 8) {
  if (!Number.isInteger(current) || current < 0)
    throw new Error("Invalid targeted attempt count");
  if (current >= maximum)
    throw new Error(`Targeted verification limit reached (${maximum})`);
  return current + 1;
}

export function parseModelUsage(value: unknown) {
  if (Array.isArray(value))
    value = value.findLast(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).type === "result",
    );
  if (!value || typeof value !== "object")
    return { cost_usd: null, turns: null, duration_ms: null };
  const record = value as Record<string, unknown>;
  const number = (key: string) =>
    typeof record[key] === "number" ? (record[key] as number) : null;
  return {
    cost_usd: number("total_cost_usd"),
    turns: number("num_turns"),
    duration_ms: number("duration_ms"),
  };
}
