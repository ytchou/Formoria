import { type PriceRow, type TokenUsage } from "../llm-pricing";
import { LIMITS, type Budget } from "./types";
export class BudgetStop extends Error {}
export function assertBudget(budget: Budget): void {
  if (budget.costUncertain)
    throw new BudgetStop(
      "Provider usage is uncertain; further model spending stopped",
    );
  if (budget.activeMs >= LIMITS.activeMs)
    throw new BudgetStop("Active processing time budget exhausted");
}
export function reserveModelCost(
  budget: Budget,
  price: PriceRow | null,
  request: Record<string, unknown>,
): number {
  assertBudget(budget);
  if (
    !price ||
    [price.input_per_m, price.output_per_m, price.cached_input_per_m].some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  )
    throw new BudgetStop("Model pricing is unknown");
  if (request.model && request.model !== price.model)
    throw new BudgetStop("Model changed from the recorded pricing snapshot");
  const output = request.max_completion_tokens ?? request.max_tokens;
  if (!Number.isSafeInteger(output) || Number(output) <= 0)
    throw new BudgetStop("Output token budget is missing");
  if (budget.modelAttempts >= LIMITS.modelAttempts)
    throw new BudgetStop("Physical model request budget exhausted");
  // UTF-8 bytes overbound text tokens; include tool/schema JSON and generous message framing. Cached input gets no discount in reservations.
  const messages = Array.isArray(request.messages)
    ? request.messages.length
    : 0;
  const inputBound =
    Buffer.byteLength(JSON.stringify(request), "utf8") + 1024 + messages * 512;
  const reserved =
    Math.ceil(
      inputBound * Math.max(price.input_per_m, price.cached_input_per_m) +
        Number(output) * price.output_per_m,
    ) / 1_000_000;
  if (budget.costUsd + budget.reservedUsd + reserved > LIMITS.costUsd)
    throw new BudgetStop("Model dollar budget exhausted");
  budget.modelAttempts++;
  budget.reservedUsd += reserved;
  return reserved;
}
export function settleModelCost(
  budget: Budget,
  price: PriceRow,
  reserved: number,
  usage: TokenUsage | undefined,
): void {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (
    !usage ||
    !Number.isSafeInteger(usage.prompt_tokens) ||
    !Number.isSafeInteger(usage.completion_tokens) ||
    Number(usage.prompt_tokens) < 0 ||
    Number(usage.completion_tokens) < 0 ||
    !Number.isSafeInteger(cached) ||
    cached < 0 ||
    cached > Number(usage.prompt_tokens)
  ) {
    budget.costUncertain = true;
    throw new BudgetStop("Provider usage is uncertain");
  }
  const cost =
    Math.ceil(
      (Number(usage.prompt_tokens) - cached) * price.input_per_m +
        cached * price.cached_input_per_m +
        Number(usage.completion_tokens) * price.output_per_m,
    ) / 1_000_000;
  if (
    !Number.isFinite(cost) ||
    cost > reserved ||
    budget.costUsd + cost > LIMITS.costUsd
  ) {
    budget.costUncertain = true;
    throw new BudgetStop("Provider usage exceeds reserved budget");
  }
  budget.costUsd += cost;
  budget.reservedUsd = Math.max(0, budget.reservedUsd - reserved);
}
export function reserveFetch(budget: Budget, url: string): void {
  assertBudget(budget);
  if (!budget.sourceUrls.includes(url)) {
    if (budget.sourceUrls.length >= LIMITS.sourcePages)
      throw new BudgetStop("Source page budget exhausted");
    budget.sourceUrls.push(url);
  }
  if (budget.fetchAttempts >= LIMITS.fetchAttempts)
    throw new BudgetStop("Fetch/render attempt budget exhausted");
  budget.fetchAttempts++;
}
