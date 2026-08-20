import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MIGRATIONS_DIR,
  SEED_BEGIN_MARKER,
  SEED_END_MARKER,
  TAXONOMY_TERMS_MIGRATION,
  buildTaxonomyTermRows,
  main,
  parseTaxonomyTermsSeed,
  resolveTaxonomyTermsMigration,
} from "../generate-taxonomy-terms";

/**
 * The generator rewrites a block inside a migration file. A migration is
 * immutable once the ledger has run it, so the only defect this suite is built
 * around is `--write` editing an APPLIED file: the checksum the database
 * recorded and the bytes on disk diverge, nothing in CI reads both, and the
 * next `supabase db push` on a fresh database applies SQL that never ran here.
 */
const temporaryDirectories: string[] = [];

function migrationsFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "taxonomy-terms-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A migration carrying the markers with a seed that is deliberately stale. */
function seededMigration(): string {
  return [
    "begin;",
    SEED_BEGIN_MARKER,
    "insert into public.taxonomy_terms (axis, slug, name_zh, name_en) values",
    "  ('l1', 'stale-fixture', '過期', 'Stale Fixture');",
    SEED_END_MARKER,
    "commit;",
    "",
  ].join("\n");
}

/** Replaces `process.exit` with a throw so the refusal is observable. */
function captureExit() {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: number | string | null): never => {
      throw new Error(`process.exit(${String(code)})`);
    });
  return { exit, errors };
}

describe("generate-taxonomy-terms migration resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (temporaryDirectories.length > 0) {
      const directory = temporaryDirectories.pop();
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  });

  // Bug caught: a hard-coded target. DEV-1507 ships a NEW migration carrying
  // the seed, and a literal path would keep pointing the generator at the
  // applied one it replaced.
  it("resolves_the_newest_marker_carrying_migration", () => {
    const directory = migrationsFixture();
    writeFileSync(
      join(directory, "20260101000000_first_seed.sql"),
      seededMigration(),
    );
    writeFileSync(
      join(directory, "20260202000000_second_seed.sql"),
      seededMigration(),
    );
    // Newer, but carries no markers — a schema-only migration must not become
    // the target just by sorting last.
    writeFileSync(
      join(directory, "20260303000000_unrelated.sql"),
      "alter table public.brands add column noop text;\n",
    );
    // `reverse/` holds down migrations under the same version prefixes.
    mkdirSync(join(directory, "reverse"));
    writeFileSync(
      join(directory, "reverse", "20260404000000_revert_seed.sql"),
      seededMigration(),
    );

    expect(resolveTaxonomyTermsMigration(directory)).toBe(
      join(directory, "20260202000000_second_seed.sql"),
    );

    // The repository's own target obeys the same rule rather than a literal,
    // so it follows DEV-1507's new migration with no edit here.
    const carriers = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .filter((file) => {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        return sql.includes(SEED_BEGIN_MARKER) && sql.includes(SEED_END_MARKER);
      })
      .sort();
    const newest = carriers.at(-1);
    expect(newest).toBeDefined();
    expect(TAXONOMY_TERMS_MIGRATION).toBe(join(MIGRATIONS_DIR, newest ?? ""));
  });

  // Bug caught: `--write` silently rewriting a migration the database already
  // ran. The refusal must be a hard exit that names the file, and it must hold
  // when no credentials are available to read the ledger at all.
  it("refuses_to_write_into_an_applied_migration", () => {
    const directory = migrationsFixture();
    const target = join(directory, "20260101000000_applied_seed.sql");
    writeFileSync(target, seededMigration());
    const before = readFileSync(target, "utf8");

    const { exit, errors } = captureExit();

    expect(() =>
      main(["--write"], {
        migrationsDir: directory,
        readAppliedVersions: () => new Set(["20260101000000"]),
      }),
    ).toThrow("process.exit(1)");
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join("\n")).toContain("20260101000000_applied_seed.sql");
    expect(readFileSync(target, "utf8")).toBe(before);

    // Credentials absent: the guard falls back to refusing any target that is
    // not the newest migration on disk, rather than no-opping into a write.
    writeFileSync(
      join(directory, "20260505000000_later_schema_change.sql"),
      "alter table public.brands add column noop text;\n",
    );
    errors.length = 0;
    expect(() =>
      main(["--write"], {
        migrationsDir: directory,
        readAppliedVersions: () => null,
      }),
    ).toThrow("process.exit(1)");
    expect(errors.join("\n")).toContain("20260101000000_applied_seed.sql");
    expect(errors.join("\n")).toContain("20260505000000_later_schema_change.sql");
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  it("writes_into_an_unapplied_migration", () => {
    const directory = migrationsFixture();
    writeFileSync(
      join(directory, "20260101000000_applied_schema.sql"),
      "create table public.taxonomy_terms ();\n",
    );
    const target = join(directory, "20260202000000_new_seed.sql");
    writeFileSync(target, seededMigration());

    vi.spyOn(console, "log").mockImplementation(() => {});
    main(["--write"], {
      migrationsDir: directory,
      readAppliedVersions: () => new Set(["20260101000000"]),
    });

    const written = readFileSync(target, "utf8");
    expect(written).toContain(SEED_BEGIN_MARKER);
    expect(written).not.toContain("stale-fixture");
    expect(parseTaxonomyTermsSeed(written)).toEqual(buildTaxonomyTermRows());
    // The surrounding migration body survives the rewrite.
    expect(written.startsWith("begin;")).toBe(true);
    expect(written.trimEnd().endsWith("commit;")).toBe(true);
  });
});
