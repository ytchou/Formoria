import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(
  resolve(import.meta.dirname, "../supabase/fixtures/staging.sql"),
  "utf8",
).toLowerCase();

describe("staging fixture privacy contract", () => {
  it("contains forty fixed staging brand identifiers and every product category", () => {
    // 40, not 42: the two extra identifiers were the id range bounds of the
    // `brand_channels` CTE, deleted with that block on 2026-08-17.
    expect(fixture.match(/51000000-0000-4000-8000-\d{12}/g)).toHaveLength(40);
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
    const seedTargets = Array.from(
      fixture.matchAll(/^(?:insert into|update)\s+([a-z_.]+)/gm),
      (match) => match[1],
    );
    const deleteTargets = Array.from(
      fixture.matchAll(/^delete from\s+([a-z_.]+)/gm),
      (match) => match[1],
    );
    // SEEDS BRANDS ONLY. The fixture must never INSERT `public.brand_channels`
    // again: a channel tells a reader where they can actually buy something,
    // and the forty `Staging Fixture • <brand>` rows pointed at example.com
    // from inside the same list as real, source-backed stockists.
    expect(new Set(seedTargets)).toEqual(new Set(["public.brands"]));
    // The one permitted delete is the cleanup of those already-seeded rows —
    // deleting the insert block alone left them in staging forever.
    expect(new Set(deleteTargets)).toEqual(new Set(["public.brand_channels"]));
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

  it("is idempotent and seeds no fabricated channels", () => {
    expect(fixture.match(/on conflict \(id\) do update/g)).toHaveLength(1);
    // The cleanup is bounded by the exact id range the deleted block wrote, so
    // it is a no-op on re-run and can never reach a real channel.
    expect(fixture).toContain(
      "delete from public.brand_channels\nwhere id between '52000000-0000-4000-8000-000000000001'::uuid\n            and '52000000-0000-4000-8000-000000000040'::uuid;",
    );
    // Two rehearsal rows went with the block: one carried no address and one an
    // unmatched address, which existed to exercise the address-less and
    // unmatched-district render paths. That coverage is gone by choice — see
    // the write-target assertion above for why.
    //
    // Matched on the generated VALUES, not on prose: the file's own header
    // explains the deletion and necessarily names what it deleted.
    expect(fixture).not.toContain("'staging fixture \u2022 '");
    expect(fixture).not.toContain("example.com/staging-fixture");
    expect(fixture).not.toContain("unmatched staging-only address");
  });
});
