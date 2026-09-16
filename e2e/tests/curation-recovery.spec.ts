import { test, expect } from "@playwright/test";
import { verifyAtomicRecovery } from "../fixtures/curation-recovery";

// Catches submission updates and checkpoint acknowledgements diverging on rejection or rollback.
test("recovery commits only eligible checkpoints atomically with a pending submission", () => {
  expect(verifyAtomicRecovery()).toEqual({
    description: "committed",
    checkpointConsumed: true,
  });
});
