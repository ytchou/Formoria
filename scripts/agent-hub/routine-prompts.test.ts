import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const routinePrompts = [
  "directory-health",
  "growth-pulse",
  "sentry-triage",
];

describe("Formoria Routine delivery contracts", () => {
  for (const routine of routinePrompts) {
    it(`${routine} reports directly without repository delivery artifacts`, async () => {
      const prompt = await readFile(
        `docs/routines/${routine}-prompt.md`,
        "utf8",
      );

      expect(prompt).toContain("node scripts/agent-hub/report-run.mjs --file");
      expect(prompt).toContain(`/tmp/formoria-${routine}.json`);
      expect(prompt).not.toMatch(/git (add|commit|pull --rebase)/);
      expect(prompt).not.toMatch(/\n\s*git push\s*\n/);
      expect(prompt).not.toContain("routine-outputs/");
      expect(prompt).not.toContain("slack-messages/");
    });
  }

  it("evaluates Directory Health weekly checks in the configured timezone", async () => {
    const prompt = await readFile(
      "docs/routines/directory-health-prompt.md",
      "utf8",
    );

    expect(prompt).toContain("TZ=Asia/Taipei date +%u");
    expect(prompt).not.toContain("date -u +%u");
  });
});
