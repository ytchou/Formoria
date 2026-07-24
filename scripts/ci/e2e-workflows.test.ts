import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function remoteActions(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("E2E workflow contracts", () => {
  it("e2e-pr workflow is manual-only while smoke gate is pending (DEV-1154)", async () => {
    const workflow = await readFile(".github/workflows/e2e-pr.yml", "utf8");

    expect(workflow).toMatch(/^name: E2E PR \(selective\)$/m);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("--only-changed=origin/main");
    expect(workflow).toContain("continue-on-error: true");
    expect(
      remoteActions(workflow).every((action) => /@[0-9a-f]{40}$/.test(action)),
    ).toBe(true);
  });

  it("keeps nightly writer serialization and reports auto-merge honestly", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );

    expect(workflow).toContain("group: formoria-agent-writer");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("merged=true");
    expect(workflow).not.toContain("MERGED_FOR_REPORT");
    expect(workflow).toContain("auto_merge_enabled=true");
    expect(workflow).toContain(
      'auto_merge_enabled: ($auto_merge_enabled == "true")',
    );
    expect(workflow).toMatch(/anthropics\/claude-code-action@[0-9a-f]{40}/);
    expect(workflow).toContain("steps.fix.outputs.structured_output");
    expect(workflow).not.toContain("steps.fix.outputs.result");
    expect(workflow).toContain('--json-schema {"type":"object"');
    expect(workflow).toMatch(/pnpm\/action-setup@[0-9a-f]{40}/);
    expect(
      remoteActions(workflow).every((action) => /@[0-9a-f]{40}$/.test(action)),
    ).toBe(true);
  });

  it("pins every remote action in the stable pull-request checks", async () => {
    const workflow = await readFile(
      ".github/workflows/frontend-ci.yml",
      "utf8",
    );
    const actions = remoteActions(workflow);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => /@[0-9a-f]{40}$/.test(action))).toBe(true);
  });

  it("drops the legacy search function before changing its returned row type", async () => {
    const migration = await readFile(
      "supabase/migrations/20260618130000_fix_search_brands_product_type.sql",
      "utf8",
    );
    const drop = migration.indexOf(
      "DROP FUNCTION IF EXISTS public.search_brands(text, integer);",
    );
    const create = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.search_brands",
    );

    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("creates the final enrichment timestamp on a clean migration replay", async () => {
    const migration = await readFile(
      "supabase/migrations/20260622130000_rename_tags_to_brand_enriched_at.sql",
      "utf8",
    );

    expect(migration).toContain("column_name = 'tags_enriched_at'");
    expect(migration).toContain("column_name = 'brand_enriched_at'");
    expect(migration).toContain("ADD COLUMN brand_enriched_at timestamptz");
  });

});
