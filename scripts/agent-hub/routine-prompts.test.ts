import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Formoria unified routine delivery contracts", () => {
  it("delivers three envelopes via report-run.mjs", async () => {
    const prompt = await readFile(
      "docs/routines/formoria-health-prompt.md",
      "utf8",
    );

    const deliveryMatches = prompt.match(
      /node scripts\/agent-hub\/report-run\.mjs --file/g,
    );
    expect(deliveryMatches?.length).toBeGreaterThanOrEqual(3);

    expect(prompt).toContain("/tmp/formoria-directory-health.json");
    expect(prompt).toContain("/tmp/formoria-sentry-triage.json");
    expect(prompt).toContain("/tmp/formoria-growth-pulse.json");
  });

  it("does not commit delivery artifacts to the repository", async () => {
    const prompt = await readFile(
      "docs/routines/formoria-health-prompt.md",
      "utf8",
    );

    expect(prompt).not.toMatch(/git (add|commit|pull --rebase)/);
    expect(prompt).not.toContain("routine-outputs/");
    expect(prompt).not.toContain("slack-messages/");
  });

  it("computes dates deterministically via bash", async () => {
    const prompt = await readFile(
      "docs/routines/formoria-health-prompt.md",
      "utf8",
    );

    expect(prompt).toContain("TZ=Asia/Taipei date +%F");
    expect(prompt).toContain("TZ=Asia/Taipei date +%u");
    expect(prompt).not.toContain("date -u +%u");
  });

  it("uses the correct routine names in each envelope", async () => {
    const prompt = await readFile(
      "docs/routines/formoria-health-prompt.md",
      "utf8",
    );

    expect(prompt).toMatch(/"routine":\s*"directory-health"/);
    expect(prompt).toMatch(/"routine":\s*"sentry-triage"/);
    expect(prompt).toMatch(/"routine":\s*"growth-pulse"/);
  });
});
