import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261005100000_curation_target_no_op.sql"),
  "utf8",
);
const reverse = readFileSync(
  join(process.cwd(), "supabase/migrations/reverse/20261005100000_revert_curation_target_no_op.sql"),
  "utf8",
);

describe("curation target no_op migration (DEV-1929)", () => {
  it("adds a defaulted no_op column with no backfill", () => {
    expect(migration).toContain(
      "add column if not exists no_op boolean not null default false",
    );
    expect(migration).not.toMatch(/update public\.curation_job_targets/);
  });

  it("persists no_op from the progress update and keeps the stored value when the key is absent", () => {
    expect(migration).toContain("duration_ms integer,\n      no_op boolean\n    )");
    expect(migration).toContain("no_op = coalesce(progress_update.no_op, target.no_op)");
  });

  it("makes both gates skip no-op rows when they pick the latest run", () => {
    expect(migration).toMatch(
      /and not target\.no_op\n {2}order by target\.created_at desc, target\.id desc\n {2}limit 1;\n {2}if v_latest_target_status is distinct from 'succeeded' then\n {4}raise exception 'Refresh must have a successful enrichment run before apply';\$new\$/,
    );
    expect(migration).toMatch(
      /and not target\.no_op\n {2}order by target\.created_at desc, target\.id desc\n {2}limit 1;\n\n {2}if v_latest_target_status is distinct from 'succeeded' then\n {4}raise exception 'Submission must have a successful enrichment run before approval';\$new\$/,
    );
  });

  it("patches live definitions in place without dropping a public function", () => {
    expect(migration).toContain("pg_temp.patch_once(");
    expect(migration).not.toMatch(/drop function (if exists )?public\./i);
    expect(migration).toContain("drop function pg_temp.patch_once(text, text, text, text);");
  });

  it("provides a reverse migration that removes the filters and the column", () => {
    expect(reverse).toContain("drop column if exists no_op");
    expect(reverse).not.toMatch(/\$new\$[^$]*not target\.no_op/);
    expect(reverse).not.toMatch(/drop function (if exists )?public\./i);
  });
});
