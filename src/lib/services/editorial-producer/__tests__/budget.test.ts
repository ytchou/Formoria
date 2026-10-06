import { expect, it } from "vitest";
import { reserveModelCost, settleModelCost } from "../budget";
import { emptyBudget } from "../types";
const price = {
  model: "configured-writer",
  input_per_m: 0.2,
  cached_input_per_m: 0.02,
  output_per_m: 1.2,
  effective_from: "2026-01-01T00:00:00Z",
};
it("stops before admitting a paid attempt when its pricing is missing or belongs to another model", () => {
  const budget = emptyBudget();
  const request = {
    model: "configured-writer",
    messages: [],
    max_completion_tokens: 200,
  };
  expect(() => reserveModelCost(budget, null, request)).toThrow("pricing");
  expect(() =>
    reserveModelCost(budget, { ...price, model: "another-model" }, request),
  ).toThrow("pricing");
  expect(budget.modelAttempts).toBe(0);
  expect(budget.reservedUsd).toBe(0);
});
it("counts physical retries and refuses another request before the dollar cap", () => {
  const budget = emptyBudget();
  budget.costUsd = 0.99;
  expect(() =>
    reserveModelCost(budget, price, {
      messages: [{ role: "user", content: "小宅".repeat(3000) }],
      max_completion_tokens: 12000,
    }),
  ).toThrow("budget");
  budget.costUsd = 0;
  const reserved = reserveModelCost(budget, price, {
    messages: [{ role: "user", content: "小宅選物" }],
    max_completion_tokens: 12000,
  });
  expect(budget.modelAttempts).toBe(1);
  settleModelCost(budget, price, reserved, {
    prompt_tokens: 120,
    completion_tokens: 800,
  });
  expect(budget.costUsd).toBeCloseTo(0.000984);
  expect(budget.reservedUsd).toBe(0);
  budget.modelAttempts = 20;
  expect(() =>
    reserveModelCost(budget, price, {
      messages: [],
      max_completion_tokens: 200,
    }),
  ).toThrow("budget");
});
it("retains its reservation and stops when provider usage is uncertain", () => {
  const budget = emptyBudget();
  const reserved = reserveModelCost(budget, price, {
    messages: [],
    max_completion_tokens: 200,
  });
  expect(() => settleModelCost(budget, price, reserved, undefined)).toThrow(
    "usage",
  );
  expect(budget.reservedUsd).toBe(reserved);
  expect(budget.costUncertain).toBe(true);
  expect(() =>
    reserveModelCost(budget, price, {
      messages: [],
      max_completion_tokens: 200,
    }),
  ).toThrow("usage");
});
it("refuses impossible cached usage rather than reporting a negative cost", () => {
  const budget = emptyBudget();
  const reserved = reserveModelCost(budget, price, {
    messages: [],
    max_completion_tokens: 200,
  });
  expect(() =>
    settleModelCost(budget, price, reserved, {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: -500 },
    }),
  ).toThrow("usage");
  expect(budget.costUncertain).toBe(true);
  expect(budget.reservedUsd).toBe(reserved);
});
