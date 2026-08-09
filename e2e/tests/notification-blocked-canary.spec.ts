import { expect, test } from "@playwright/test";

test("@notification-blocked-canary remains unresolved", () => {
  expect("canary-unresolved").toBe("canary-resolved");
});
