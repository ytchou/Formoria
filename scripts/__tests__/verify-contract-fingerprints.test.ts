import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_FUNCTION_NAMES,
  buildFingerprintQuery,
  buildManagementQueryRequest,
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

/**
 * `omitFunction` truncates the fixture the way a hand-edited report loses a
 * row; `extraTableRows` appends rows the parser must reconcile with the ones
 * above.
 */
function baselineFixture(
  options: {
    omitFunction?: string;
    extraTableRows?: ReadonlyArray<readonly [string, string]>;
  } = {},
): string {
  const header = [
    "| Function | Owner | Security | Volatility | Parallel | `search_path` / config | Body bytes | MD5 |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- |",
  ];
  const tableRows = [...TABLE_ROWS, ...(options.extraTableRows ?? [])].filter(
    ([signature]) => !signature.startsWith(`${options.omitFunction ?? "\0"}(`),
  );
  const rows = tableRows.map(
    ([signature, md5], index) =>
      `| \`${signature}\` | postgres | invoker | volatile | unsafe | \`search_path=""\` | ${300 + index} | \`${md5}\` |`,
  );
  const prose =
    options.omitFunction === PROSE_SIGNATURE.slice(0, -2)
      ? []
      : [
          `The live \`${PROSE_SIGNATURE}\` trigger function is an additional`,
          "dependency, not part of the plan's exact 11. Its baseline is owner `postgres`,",
          "`SECURITY DEFINER`, volatile/unsafe, `search_path=public, extensions`, 942",
          `body bytes, and MD5 \`${PROSE_MD5}\`.`,
        ];
  return [
    "# Contract function baseline",
    "",
    "Captured 2026-08-19 against production.",
    "",
    ...header,
    ...rows,
    "",
    ...prose,
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
    expect(rows.find((row) => row.signature === PROSE_SIGNATURE)?.md5).toBe(
      PROSE_MD5,
    );
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
    expect(comparison.filter((row) => row.status === "MISMATCH")).toHaveLength(
      1,
    );
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

  it("never_prints_a_credential_from_malformed_argv", async () => {
    // These paths run BEFORE `redactSecrets` has a token to strip, so the
    // argument parser is the one place a leak cannot be cleaned up after.
    const token = "sbp_9f3c11a27d4e5b608cafe1234567890abcdef";
    const malformed: ReadonlyArray<readonly string[]> = [
      [token], // token passed positionally, with no flag at all
      ["--tokn", token], // misspelled flag, token in the value slot
      ["--ref", "example-ref", "--tokn", token],
      ["--ref", "example-ref", "--token", token, token], // stray repeat
    ];

    const lines = silenceConsole();
    const codes: number[] = [];
    for (const argv of malformed) {
      codes.push(
        await main(argv, {
          readBaseline: () => baselineFixture(),
          fetchLiveFingerprints: async () => matchingLiveRows(),
          env: {} as NodeJS.ProcessEnv,
        }),
      );
    }
    vi.restoreAllMocks();

    expect(codes.every((code) => code !== 0)).toBe(true);

    const output = lines.join("\n");
    for (let start = 0; start + 8 <= token.length; start += 1) {
      expect(output).not.toContain(token.slice(start, start + 8));
    }
    // Still actionable without the content: position, shape, and the flags.
    expect(output).toContain("argument 1 of 1");
    expect(output).toContain("--ref, --token, --baseline");
  });

  it("fails_when_the_baseline_omits_a_contract_function", async () => {
    const truncated = baselineFixture({
      omitFunction: "approve_submission_with_romanized_name",
    });

    expect(() => parseBaselineReport(truncated, "/tmp/baseline.md")).toThrow(
      /approve_submission_with_romanized_name/,
    );

    // The gate must stay red even when the same function is absent from the
    // database too — neither side compares it, so nothing else would notice.
    const liveMinusOne = matchingLiveRows().filter(
      (row) =>
        !row.signature.startsWith("approve_submission_with_romanized_name("),
    );
    const lines = silenceConsole();
    const code = await main(
      ["--ref", "example-ref", "--token", "sbp_fixture_token"],
      {
        readBaseline: () => truncated,
        fetchLiveFingerprints: async () => liveMinusOne,
        env: {} as NodeJS.ProcessEnv,
      },
    );
    vi.restoreAllMocks();

    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain(
      "approve_submission_with_romanized_name",
    );
    expect(lines.join("\n")).not.toContain("functions match the baseline");
  });

  it("dedupes_signatures_that_differ_only_in_argument_whitespace", () => {
    // `compareFingerprints` matches on the whitespace-normalised signature, so
    // dedupe must agree: two rows for one function would consume the live row
    // once and report the second as a phantom MISSING.
    const rows = parseBaselineReport(
      baselineFixture({
        extraTableRows: [
          [
            "apply_brand_refresh(uuid, uuid)",
            "abababababababababababababababab",
          ],
        ],
      }),
    );

    expect(rows).toHaveLength(12);
    expect(
      rows.filter((row) => row.signature.startsWith("apply_brand_refresh(")),
    ).toHaveLength(1);
    // The table row above wins; the spaced duplicate never reaches comparison.
    expect(rows[0]?.md5).toBe("9331b7c422bd3be07e2e36ef2a216bfa");

    const comparison = compareFingerprints(rows, matchingLiveRows());
    expect(comparison.every((row) => row.status === "match")).toBe(true);
  });

  it("sends_a_read_only_query_to_the_project_query_endpoint", () => {
    const request = buildManagementQueryRequest({
      projectRef: "example-ref",
      token: "sbp_fixture_token",
      sql: buildFingerprintQuery(),
    });

    expect(request.url).toBe(
      "https://api.supabase.com/v1/projects/example-ref/database/query",
    );
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer sbp_fixture_token");

    // The one property that makes this script safe to point at production.
    const body: unknown = JSON.parse(request.body);
    expect((body as { read_only?: unknown }).read_only).toBe(true);
    expect((body as { query?: unknown }).query).toContain("pg_get_functiondef");
  });

  it("explains_that_a_missing_baseline_file_is_a_gitignored_local_artifact", async () => {
    const lines = silenceConsole();
    const code = await main(
      ["--ref", "example-ref", "--token", "sbp_fixture_token"],
      {
        readBaseline: (path: string) => {
          throw Object.assign(
            new Error(`ENOENT: no such file or directory, open '${path}'`),
            { code: "ENOENT" },
          );
        },
        fetchLiveFingerprints: async () => matchingLiveRows(),
        env: {} as NodeJS.ProcessEnv,
      },
    );
    vi.restoreAllMocks();

    const output = lines.join("\n");
    expect(code).not.toBe(0);
    expect(output).toContain(
      "2026-08-19-dev-1503-contract-function-baseline.md",
    );
    expect(output).toContain("gitignored");
    expect(output).toContain("--baseline");
  });
});
