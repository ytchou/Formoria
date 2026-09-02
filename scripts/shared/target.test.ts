import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from "@/lib/supabase/project-target";
import { loadScriptTarget, resolveScriptTarget } from "./target";

const jwt = (ref: string, role: string) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ref, role })}.signature`;
};

const environmentFor = (ref: string) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: jwt(ref, "service_role"),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveScriptTarget", () => {
  it("defaults to staging and loads .env.staging", () => {
    expect(resolveScriptTarget([])).toMatchObject({
      target: "staging",
      envFile: ".env.staging",
    });
  });

  it("--target production loads .env.local", () => {
    expect(resolveScriptTarget(["--target", "production"])).toMatchObject({
      target: "production",
      envFile: ".env.local",
    });
  });

  it("rejects an unknown target", () => {
    expect(() => resolveScriptTarget(["--target", "prod"])).toThrow(/prod/);
  });

  it("strips --target from the returned argv", () => {
    expect(
      resolveScriptTarget(["--slug", "x", "--target", "production"]).argv,
    ).toEqual(["--slug", "x"]);
    expect(
      resolveScriptTarget(["--slug", "x", "--target=production"]).argv,
    ).toEqual(["--slug", "x"]);
  });
});

describe("loadScriptTarget", () => {
  it("throws when loaded credentials name the other project", () => {
    expect(() =>
      loadScriptTarget(["--target", "production"], {
        env: environmentFor(STAGING_PROJECT_REF),
      }),
    ).toThrow(/but this worker declares production/);
  });

  it("warns when target is production and branch is not main", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = loadScriptTarget(["--target", "production"], {
      env: environmentFor(PRODUCTION_PROJECT_REF),
      branch: "feature/dev-1318",
    });

    expect(result).toMatchObject({
      target: "production",
      projectRef: PRODUCTION_PROJECT_REF,
      argv: [],
    });
    expect(warn.mock.calls.map(String).join("\n")).toContain(
      "feature/dev-1318",
    );
  });
});
