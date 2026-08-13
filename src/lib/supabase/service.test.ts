import { describe, expect, it } from "vitest";
import { buildSupabaseUserAgent } from "./service";

describe("Supabase User-Agent attribution", () => {
  // Bug: Supabase traffic was indistinguishable across builds, requests, tests, and scripts.
  it("attributes non-PII execution context and a short deployment SHA", () => {
    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        nextPhase: "phase-production-build",
        argv: ["node", "next", "build"],
        railwayCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
      }),
    ).toBe("FormoriaSupabase/1.0 (build; commit=abcdef1)");
    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        argv: ["node", "next", "build"],
      }),
    ).toBe("FormoriaSupabase/1.0 (build)");

    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        argv: ["node", "/app/scripts/curation-worker-server.ts", "build"],
      }),
    ).toBe("FormoriaSupabase/1.0 (script)");

    expect(
      buildSupabaseUserAgent({
        nodeEnv: "development",
        argv: ["node", "next", "dev"],
      }),
    ).toBe("FormoriaSupabase/1.0 (development)");

    expect(
      buildSupabaseUserAgent({
        nodeEnv: "test",
        argv: ["node", "/repo/node_modules/vitest/vitest.mjs", "run", "build"],
      }),
    ).toBe("FormoriaSupabase/1.0 (test)");

    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        argv: ["node", "/app/server.js"],
      }),
    ).toBe("FormoriaSupabase/1.0 (runtime)");
  });
});
