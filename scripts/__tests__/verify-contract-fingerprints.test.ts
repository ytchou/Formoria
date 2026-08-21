import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_FUNCTION_NAMES,
  compareFingerprints,
  formatComparison,
  main,
  parseBaselineReport,
} from "../verify-contract-fingerprints";

/**
 * The baseline report lives under `docs/`, which is gitignored, so it does not
 * exist in CI. This fixture reproduces its structure verbatim — an 8-column
 * markdown table plus one function documented in prose OUTSIDE the table — so
 * the parser is tested without reading the real report.
 */
const TABLE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["apply_brand_refresh(uuid,uuid)", "9331b7c422bd3be07e2e36ef2a216bfa"],
  [
    "apply_brand_refresh_with_protected_location_gate(uuid,uuid)",
    "1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b",
  ],
  ["approve_submission(uuid,uuid,jsonb)", "2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c"],
  [
    "approve_submission_with_romanized_name(uuid,uuid,jsonb)",
    "3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d",
  ],
  [
    "save_submission_review(uuid,jsonb,jsonb)",
    "4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e",
  ],
  [
    "correct_approved_submission_provenance()",
    "5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f",
  ],
  [
    "brand_trgm_rank(text,text,text,text,text[],text[],text,text)",
    "6060606060606060606060606060606a",
  ],
  [
    "brands_search_document(text,text,text,text[],text[],text,text)",
    "7171717171717171717171717171717b",
  ],
  ["brands_search_vector_update()", "8282828282828282828282828282828c"],
  [
    "search_brand_page(text,text[],text[],text,integer[],integer,text)",
    "9393939393939393939393939393939d",
  ],
  [
    "search_brands(text,integer,boolean,text[],text[],text,text,boolean)",
    "7bcba2c4bd56c0d6ba50988f59e3f80e",
  ],
];

const PROSE_SIGNATURE = "brands_track_content_provenance()";
const PROSE_MD5 = "8e37621a70cd485cbcbed9c2a718c2df";

function baselineFixture(): string {
  const header = [
    "| Function | Owner | Security | Volatility | Parallel | `search_path` / config | Body bytes | MD5 |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- |",
  ];
  const rows = TABLE_ROWS.map(
    ([signature, md5], index) =>
      `| \`${signature}\` | postgres | invoker | volatile | unsafe | \`search_path=""\` | ${300 + index} | \`${md5}\` |`,
  );
  return [
    "# Contract function baseline",
    "",
    "Captured 2026-08-19 against production.",
    "",
    ...header,
    ...rows,
    "",
    `The live \`${PROSE_SIGNATURE}\` trigger function is an additional`,
    "dependency, not part of the plan's exact 11. Its baseline is owner `postgres`,",
    "`SECURITY DEFINER`, volatile/unsafe, `search_path=public, extensions`, 942",
    `body bytes, and MD5 \`${PROSE_MD5}\`.`,
    "",
  ].join("\n");
}

function baselineRows() {
  return parseBaselineReport(baselineFixture());
}

/** Live rows that agree with the baseline in every position. */
function matchingLiveRows() {
  return baselineRows().map((row) => ({ ...row }));
}

function silenceConsole() {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  return lines;
}

describe("verify-contract-fingerprints", () => {
  it("parses_the_baseline_table_into_signature_md5_pairs", () => {
    const rows = baselineRows();

    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      signature: "apply_brand_refresh(uuid,uuid)",
      md5: "9331b7c422bd3be07e2e36ef2a216bfa",
    });
    expect(rows.map((row) => row.signature)).toContain(PROSE_SIGNATURE);
    expect(
      rows.find((row) => row.signature === PROSE_SIGNATURE)?.md5,
    ).toBe(PROSE_MD5);
    // Every parsed signature must be one the live query asks for, or the
    // comparison reports a phantom "missing" function.
    for (const row of rows) {
      const name = row.signature.slice(0, row.signature.indexOf("("));
      expect(CONTRACT_FUNCTION_NAMES).toContain(name);
    }
  });

  it("reports_match_when_live_md5_equals_baseline", () => {
    const comparison = compareFingerprints(baselineRows(), matchingLiveRows());

    expect(comparison.every((row) => row.status === "match")).toBe(true);
    expect(formatComparison(comparison)).toContain(
      "apply_brand_refresh(uuid,uuid) | 9331b7c422bd3be07e2e36ef2a216bfa | 9331b7c422bd3be07e2e36ef2a216bfa | match",
    );
  });

  it("reports_mismatch_and_exits_nonzero_when_any_row_differs", async () => {
    const drifted = matchingLiveRows();
    drifted[0] = {
      signature: drifted[0]!.signature,
      md5: "00000000000000000000000000000000",
    };

    const comparison = compareFingerprints(baselineRows(), drifted);
    expect(
      comparison.filter((row) => row.status === "MISMATCH"),
    ).toHaveLength(1);
    expect(formatComparison(comparison)).toContain("MISMATCH");

    const lines = silenceConsole();
    const code = await main(
      ["--ref", "example-ref", "--token", "sbp_fixture_token"],
      {
        readBaseline: () => baselineFixture(),
        fetchLiveFingerprints: async () => drifted,
      },
    );
    vi.restoreAllMocks();

    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("MISMATCH");
  });

  it("never_prints_a_credential", async () => {
    const token = "sbp_9f3c11a27d4e5b608cafe1234567890abcdef";
    const lines = silenceConsole();

    const okCode = await main(["--ref", "example-ref", "--token", token], {
      readBaseline: () => baselineFixture(),
      fetchLiveFingerprints: async () => matchingLiveRows(),
    });

    // The failure path is where a token usually leaks: an HTTP client that
    // echoes the request, or a thrown error carrying the Authorization header.
    const failCode = await main(["--ref", "example-ref", "--token", token], {
      readBaseline: () => baselineFixture(),
      fetchLiveFingerprints: async () => {
        throw new Error(`request failed with Authorization: Bearer ${token}`);
      },
    });
    vi.restoreAllMocks();

    expect(okCode).toBe(0);
    expect(failCode).not.toBe(0);

    const output = lines.join("\n");
    for (let start = 0; start + 8 <= token.length; start += 1) {
      expect(output).not.toContain(token.slice(start, start + 8));
    }
  });
});
