import { expect, test } from "@playwright/test";

test("@notification-blocked-canary repairs one stale expectation", async ({
  page,
}) => {
  await page.goto("/en/getting-started");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Find your next favorite brand",
    }),
  ).toBeVisible();
});

test("@notification-blocked-canary remains unresolved", () => {
  expect("canary-unresolved").toBe("canary-resolved");
});
