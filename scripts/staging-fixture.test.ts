import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(
  resolve(import.meta.dirname, "../supabase/fixtures/staging.sql"),
  "utf8",
).toLowerCase();

describe("staging fixture privacy contract", () => {
  it("contains forty fixed staging brand identifiers and every product category", () => {
    expect(fixture.match(/51000000-0000-4000-8000-\d{12}/g)).toHaveLength(42);
    for (const category of [
      "bags-accessories",
      "beauty",
      "crafts",
      "fashion",
      "fitness",
      "food-drink",
      "home",
      "jewelry",
      "kids-pets",
      "outdoor",
      "stationery",
      "tech",
    ]) {
      expect(fixture).toContain(`'${category}'`);
    }
  });

  it("writes only public fixture tables and never private columns", () => {
    const writeTargets = Array.from(
      fixture.matchAll(/^(?:insert into|update|delete from)\s+([a-z_.]+)/gm),
      (match) => match[1],
    );
    expect(new Set(writeTargets)).toEqual(
      new Set(["public.brands", "public.brand_channels"]),
    );
    for (const prohibited of [
      "auth.users",
      "public.profiles",
      "brand_owners",
      "brand_submissions",
      "contact_email",
      "admin_audit_log",
      "visitor_hash",
      "app_secrets",
      "storage.objects",
    ]) {
      expect(fixture).not.toContain(prohibited);
    }
  });

  it("is idempotent and preserves two unmatched district rehearsal rows", () => {
    expect(fixture.match(/on conflict \(id\) do update/g)).toHaveLength(2);
    expect(fixture).toContain("fixture_number = 39 then null");
    expect(fixture).toContain(
      "fixture_number = 40 then 'unmatched staging-only address'",
    );
  });
});
