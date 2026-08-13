import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260813055010_cron_http_dispatch_durable_identity.sql",
  ),
  "utf8",
).toLowerCase();

describe("cron HTTP dispatch identity migration", () => {
  it("attributes a reused pg_net request id to the newest dispatch without replacing old outcomes", () => {
    expect(migration).toMatch(
      /add column dispatch_id\s+uuid\s+default\s+gen_random_uuid\(\)/,
    );
    expect(migration).toContain(
      "drop constraint if exists cron_http_dispatch_pkey",
    );
    expect(migration).toMatch(
      /add constraint cron_http_dispatch_pkey primary key\s*\(dispatch_id\)/,
    );
    expect(migration).toContain(
      "drop constraint if exists cron_http_log_pkey",
    );
    expect(migration).toMatch(
      /add constraint cron_http_log_pkey primary key\s*\(dispatch_id\)/,
    );

    expect(migration).toContain("response.created >= dispatch.dispatched_at");
    expect(migration).toMatch(/row_number\(\) over\s*\(/);
    expect(migration).toMatch(/partition by response\.id/);
    expect(migration).toMatch(
      /order by dispatch\.dispatched_at desc, dispatch\.dispatch_id desc/,
    );
    expect(migration).toContain("on conflict (dispatch_id) do update");
    expect(migration).not.toMatch(/on conflict\s*\(request_id\)\s*do update/);
  });
});
