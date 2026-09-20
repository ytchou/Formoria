import { describe, expect, it, vi } from "vitest";
import { runOpsCodeFix } from "../code-fix";

function makeClientResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "done" as const,
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    changedFiles: [
      {
        path: "src/lib/services/brands/slug.ts",
        content: "export const normalizeSlug = () => 'formoria';\n",
      },
    ],
    agent: {
      structuredOutput: {
        status: "changed",
        summary: "Corrected slug normalization.",
        changedFiles: ["src/lib/services/brands/slug.ts"],
        verification: ["pnpm lint"],
      },
    },
    ...overrides,
  };
}

describe("Slack Ops Agent Railway code fix", () => {
  it("publishes a scoped repo-worker patch as a draft PR", async () => {
    const run = vi.fn().mockResolvedValue(makeClientResult());
    const publish = vi.fn().mockResolvedValue({
      ok: true,
      prUrl: "https://github.com/ytchou/Formoria/pull/1203",
      prNumber: 1203,
    });

    const result = await runOpsCodeFix(
      {
        instruction: "Fix the Unicode slug normalization for 品牌名稱.",
        requestId: "8e6976e5-5346-4c18-9fb0-2b5d80c2c937",
      },
      {
        createClient: () => ({ run }),
        publish,
      },
    );

    expect(result).toEqual({
      ok: true,
      prUrl: "https://github.com/ytchou/Formoria/pull/1203",
      prNumber: 1203,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "staging",
        editableFiles: ["**/*"],
        blockedFiles: [".github/**", "supabase/migrations/**"],
        agent: expect.objectContaining({ access: "write" }),
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "ops-agent/8e6976e5-5346-4c18-9fb0-2b5d80c2c937",
        draft: true,
        blockedPaths: [".github/", "supabase/migrations/"],
      }),
    );
  });

  it("fails when the worker reports an out-of-policy mutation", async () => {
    const publish = vi.fn();
    const result = await runOpsCodeFix(
      {
        instruction: "Change the CI workflow to skip validation.",
        requestId: "dcd483dc-84bc-420e-bd29-496ef5bc26d9",
      },
      {
        createClient: () => ({
          run: vi.fn().mockResolvedValue(
            makeClientResult({ revertedFiles: [".github/workflows/frontend-ci.yml"] }),
          ),
        }),
        publish,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "Fix attempted changes outside policy: .github/workflows/frontend-ci.yml",
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
