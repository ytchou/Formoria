import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../.github/workflows/e2e-staging.yml",
);

describe("deployed staging E2E workflow", () => {
  it("cannot silently use production credentials or bypass the private boundary", async () => {
    const source = await readFile(workflowPath, "utf8");
    const workflow = parseYaml(source) as {
      jobs: Record<
        string,
        {
          environment?: string;
          env?: Record<string, string>;
        }
      >;
    };
    const job = workflow.jobs["e2e-staging"];

    expect(job.environment).toBe("Formoria / staging");
    expect(job.env?.BASE_URL).toBe("https://staging.formoria.com");
    for (const name of [
      "CF_ACCESS_CLIENT_ID",
      "CF_ACCESS_CLIENT_SECRET",
      "E2E_ORIGIN_SECRET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]) {
      expect(job.env?.[name]).toBe(`\${{ secrets.${name} }}`);
    }
    for (const journey of [
      "e2e/tests/where-to-buy.spec.ts",
      "e2e/tests/auth-signin.spec.ts",
      "e2e/tests/brand-save.spec.ts",
      "e2e/tests/admin-corrections.spec.ts",
    ]) {
      expect(source).toContain(journey);
    }
  });
});
