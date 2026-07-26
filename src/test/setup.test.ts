import { describe, expect, it } from "vitest";
import { isSafeTestDatabaseUrl } from "./setup";

describe("Supabase integration target safety", () => {
  it("accepts local Supabase and rejects the production project", () => {
    expect(isSafeTestDatabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(
      isSafeTestDatabaseUrl("https://xkcayngbttpxyibgzern.supabase.co"),
    ).toBe(false);
  });

  it("accepts only the explicitly named remote test project", () => {
    expect(
      isSafeTestDatabaseUrl(
        "https://formoria-integration.supabase.co",
        "formoria-integration",
      ),
    ).toBe(true);
    expect(
      isSafeTestDatabaseUrl(
        "https://unrelated-project.supabase.co",
        "formoria-integration",
      ),
    ).toBe(false);
    expect(
      isSafeTestDatabaseUrl(
        "https://xkcayngbttpxyibgzern.supabase.co",
        "xkcayngbttpxyibgzern",
      ),
    ).toBe(false);
  });
});
