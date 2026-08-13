import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(
  resolve(import.meta.dirname, "../supabase/bootstrap/staging.sql"),
  "utf8",
).toLowerCase();
const replayHarnessSource = readFileSync(
  resolve(import.meta.dirname, "./db-clean-replay.sh"),
  "utf8",
);
const replayHarness = replayHarnessSource.toLowerCase();
const deployGuard = readFileSync(
  resolve(import.meta.dirname, "./db-deploy.ts"),
  "utf8",
).toLowerCase();
const hostedSchemaNormalization = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/bootstrap/normalize-hosted-schema.sql",
  ),
  "utf8",
).toLowerCase();
const auditedDataOnlyMigrations = [
  "20260804150000_reapply_unigaze_merge_due_timestamp_collision.sql",
  "20260811070416_apply_reviewed_link_corrections.sql",
];

describe("staging database bootstrap contracts", () => {
  it("creates inert health agent roles only when they are absent", () => {
    for (const role of ["health_agent_reader", "health_agent_writer"]) {
      expect(bootstrap).toMatch(
        new RegExp(
          `if not exists[\\s\\S]*create role ${role} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
        ),
      );
      expect(bootstrap).not.toMatch(new RegExp(`alter role ${role}`));
    }
  });

  it("disables the seed file while starting a schema-only replay project", () => {
    expect(replayHarness).toMatch(/\[db\.seed\][\s\S]*enabled = false/);
  });

  it("starts only PostgreSQL services during the schema-only replay", () => {
    expect(replayHarness).toContain(
      "--exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    );
  });

  it("applies multi-statement SQL through the temporary local database URL", () => {
    expect(replayHarness).toContain(
      'supabase status --workdir "$replay_root" -o env',
    );
    expect(replayHarness).toContain(
      'psql --dbname "$local_db_url" --set on_error_stop=1',
    );
    expect(replayHarness).not.toMatch(
      /supabase db query --local --workdir "\$replay_root"[\s\S]*--file "\$replay_root\/supabase\/bootstrap\//,
    );
  });

  it("checks replay counts as exact local psql scalar results", () => {
    expect(replayHarness).toContain(
      'ledger=$(\n  psql --dbname "$local_db_url"',
    );
    expect(replayHarness).toContain('cron=$(\n  psql --dbname "$local_db_url"');
    expect(replayHarness).toContain("--tuples-only --no-align");
    expect(replayHarness).toContain('if [[ "$ledger" != "$expected" ]]');
    expect(replayHarness).toContain('if [[ "$cron" != "0" ]]');
    expect(replayHarness).not.toContain(
      'supabase db query --local --workdir "$replay_root"',
    );
  });

  it("generates replay types through the explicit local database URL", () => {
    expect(replayHarness).toContain(
      'supabase gen types typescript \\\n  --db-url "$local_db_url"',
    );
    expect(replayHarness).not.toContain(
      'supabase gen types typescript --local --workdir "$replay_root"',
    );
  });

  it("isolates each replay project and destroys only its exact temporary workdir", () => {
    expect(replayHarness).toContain(
      "replay_suffix=${replay_name#formoria-db-replay.}",
    );
    expect(replayHarness).toContain(
      'replay_project_id="formoria-db-replay-${replay_suffix}"',
    );
    expect(replayHarness).toContain(
      'supabase stop --workdir "$replay_root" --no-backup',
    );
    expect(replayHarness).toMatch(
      /case "\$replay_root" in[\s\S]*supabase stop --workdir "\$replay_root" --no-backup[\s\S]*rm -rf "\$replay_root"/,
    );
    expect(replayHarness).not.toContain('project_id = "formoria-db-replay"');
  });

  it("marks only the audited production-data-only migrations as applied", () => {
    const allowlist = replayHarness.match(
      /audited_data_only_migrations=\(\n([\s\S]*?)\n\)/,
    );
    expect(allowlist?.[1].match(/"[^\"]+\.sql"/g)).toEqual(
      auditedDataOnlyMigrations.map((migration) => `"${migration}"`),
    );
    for (const migration of auditedDataOnlyMigrations) {
      expect(
        existsSync(
          resolve(import.meta.dirname, "../supabase/migrations", migration),
        ),
      ).toBe(true);
      expect(replayHarness).toContain(`"${migration}"`);
    }

    const allowlistedLoop = replayHarness.match(
      /for migration_file in "\$\{audited_data_only_migrations\[@\]\}"; do[\s\S]*?done/,
    )?.[0];
    expect(allowlistedLoop).toBeDefined();
    expect(allowlistedLoop).toContain(
      'migration_path="$replay_root/supabase/migrations/$migration_file"',
    );
    expect(allowlistedLoop).not.toContain("migrations/*");
    expect(allowlistedLoop).not.toContain("*.sql");
    expect(replayHarness).not.toContain('mv "$migration_path"');
    expect(replayHarness).not.toContain("migrations.data-only");
    expect(replayHarness).toContain("migration repair");
    expect(replayHarness).toContain(
      '--local --status applied "$migration_version" --workdir "$replay_root"',
    );
    expect(replayHarness).not.toContain("migration repair --linked");
  });

  it("counts all repository migrations without removing any from the replay copy", () => {
    const expectedCount = replayHarness.indexOf(
      "expected=$(find \"$replay_root/supabase/migrations\" -type f -name '*.sql'",
    );
    const repair = replayHarness.indexOf(
      'for migration_file in "${audited_data_only_migrations[@]}"; do',
    );
    expect(expectedCount).toBeGreaterThanOrEqual(0);
    expect(expectedCount).toBeLessThan(repair);
    expect(replayHarness).toContain(
      'cp -r "$repo_root/supabase" "$replay_root/supabase"',
    );
    expect(replayHarness).not.toContain('mv "$repo_root/supabase/migrations"');
  });

  it("uses the bootstrapped clean replay for explicit remote drift verification", () => {
    expect(replayHarness).toContain('--from "$local_db_url"');
    expect(replayHarness).toContain('--to "$formoria_compare_db_url"');
    expect(deployGuard).toContain(
      "formoria_compare_db_url: target.databaseurl",
    );
    expect(deployGuard).not.toContain(
      '["db", "diff", "--db-url", target.databaseurl',
    );
    expect(replayHarness).toContain(
      '--file "$replay_root/supabase/bootstrap/normalize-hosted-schema.sql"',
    );
    for (const policy of [
      "health_agent_reader_approved_brands",
      "health_agent_reader_fix_queue",
      "health_agent_reader_snapshots",
      "health_agent_reader_link_results",
      "health_agent_reader_run_ledger",
    ]) {
      expect(hostedSchemaNormalization).toContain(`create policy ${policy}`);
    }
  });

  it("keeps Docker-backed repository checks out of Railway pre-deploy", () => {
    expect(deployGuard).toContain("verify(target, false)");
    expect(deployGuard).toMatch(
      /if \(includeschemadiff\) \{[\s\S]*gen[\s\S]*types[\s\S]*verifyschemadrift\(target\)/,
    );
  });

  it("accepts only the documented pg_net schema-placement diff", () => {
    const schemaDiffPolicy = replayHarnessSource.match(
      /(^|\n)(is_allowed_pg_net_schema_diff\(\) \{[\s\S]*?\n\})/,
    )?.[2];
    expect(schemaDiffPolicy).toBeDefined();

    const allowsSchemaDiff = (diff: string): boolean =>
      spawnSync(
        "bash",
        [
          "-c",
          `${schemaDiffPolicy}\nis_allowed_pg_net_schema_diff "$1"`,
          "schema-diff-test",
          diff,
        ],
        { encoding: "utf8" },
      ).status === 0;

    expect(
      allowsSchemaDiff(
        "DROP  EXTENSION pg_net ;\nCREATE EXTENSION\tpg_net WITH SCHEMA public;",
      ),
    ).toBe(true);
    expect(
      allowsSchemaDiff(
        [
          "-- Migration unit 1: schema_changes",
          "-- Transaction mode: transactional",
          "-- Boundary reason: default",
          "DROP  EXTENSION pg_net ;",
          "CREATE EXTENSION\tpg_net WITH SCHEMA public;",
        ].join("\n"),
      ),
    ).toBe(true);
    for (const drift of [
      "",
      "DROP EXTENSION pg_net;",
      "DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA private;",
      "CREATE EXTENSION pg_net WITH SCHEMA public; DROP EXTENSION pg_net;",
      "DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA public; CREATE EXTENSION extra;",
      "DROP EXTENSION pg_net; -- inline comment\nCREATE EXTENSION pg_net WITH SCHEMA public;",
      "DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA public; -- trailing comment",
    ]) {
      expect(allowsSchemaDiff(drift)).toBe(false);
    }
  });
});
