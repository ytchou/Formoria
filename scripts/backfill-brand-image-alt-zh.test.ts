import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MANIFEST_VERSION,
  assertManifestEnvironment,
  buildAltOnlyUpdate,
  classifyApplyState,
  mapCaptionsByImageId,
  parseCaptionBatch,
  parseManifest,
  selectReviewImages,
  serializeManifest,
  type BackfillImage,
  type ManifestHeader,
  type ManifestImageRecord,
} from "./backfill-brand-image-alt-zh";

const CAPTION_A =
  "米白色陶瓷杯放在木桌上，杯旁擺著乾燥花與一本打開的書，背景灑入柔和日光。";
const CAPTION_B =
  "深藍帆布提袋靠在淺色牆面前，袋口露出一束小花，正面印有白色幾何圖案。";

function image(
  id: string,
  source = "scrape",
  overrides: Partial<BackfillImage> = {},
): BackfillImage {
  return {
    id,
    brandId: "5e58c6aa-f2d9-42dd-8e9c-450d8e2fa4dd",
    brandSlug: "shan-lin-ceramics",
    brandName: "山林陶作",
    source,
    storagePath: `brands/5e58c6aa-f2d9-42dd-8e9c-450d8e2fa4dd/${id}.webp`,
    ...overrides,
  };
}

function header(): ManifestHeader {
  const prompt = "只描述圖片中可見的內容。";
  return {
    kind: "header",
    manifestVersion: MANIFEST_VERSION,
    generatedAt: "2026-08-31T08:00:00.000Z",
    environment: {
      projectRef: "staging-project-ref",
      host: "staging-project-ref.supabase.co",
    },
    provenance: {
      model: "gpt-5.6-luna",
      profile: "classifyImages",
      imageDetail: "low",
      reasoningEffort: "none",
      prompt,
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
    },
    selection: {
      brandStatus: "approved",
      imageStatus: "active",
      altZh: null,
    },
  };
}

function proposedRecord(): ManifestImageRecord {
  return {
    kind: "image",
    image: image("image-001"),
    batchId: "batch-001",
    ordinal: "1",
    result: { status: "proposed", caption: CAPTION_A },
  };
}

describe("caption parsing and ordinal mapping", () => {
  it("maps reordered model results by explicit ordinal rather than array position", () => {
    const parsed = parseCaptionBatch(
      JSON.stringify({
        captions: [
          { id: "2", caption: CAPTION_B },
          { id: "1", caption: CAPTION_A },
        ],
      }),
      ["1", "2"],
    );

    expect(parsed.failures).toEqual(new Map());
    expect(
      mapCaptionsByImageId(
        [image("image-001"), image("image-002")],
        parsed.captions,
      ),
    ).toEqual(
      new Map([
        ["image-001", CAPTION_A],
        ["image-002", CAPTION_B],
      ]),
    );
  });

  it("rejects missing, duplicate, and out-of-range captions without shifting neighbors", () => {
    const parsed = parseCaptionBatch(
      JSON.stringify({
        captions: [
          { id: "1", caption: "陶".repeat(29) },
          { id: "1", caption: CAPTION_A },
          { id: "2", caption: "杯".repeat(81) },
        ],
      }),
      ["1", "2", "3"],
    );

    expect(parsed.captions.size).toBe(0);
    expect(parsed.failures.get("1")).toMatch(/duplicate/i);
    expect(parsed.failures.get("2")).toMatch(/30–80/);
    expect(parsed.failures.get("3")).toMatch(/missing/i);
  });
});

describe("deterministic review sampling", () => {
  it("selects the same 50 managed images regardless of input order and includes every owner/admin image", () => {
    const managed = Array.from({ length: 60 }, (_, index) =>
      image(`managed-${String(index).padStart(2, "0")}`),
    );
    const protectedImages = [
      image("owner-01", "owner"),
      image("admin-01", "admin"),
    ];

    const first = selectReviewImages([...managed, ...protectedImages]);
    const second = selectReviewImages(
      [...managed, ...protectedImages].toReversed(),
    );

    expect(first.map((row) => row.id)).toEqual(second.map((row) => row.id));
    expect(first).toHaveLength(52);
    expect(first.map((row) => row.id)).toEqual(
      expect.arrayContaining(["owner-01", "admin-01"]),
    );
  });
});

describe("manifest integrity and environment binding", () => {
  it("round-trips a checksummed manifest and rejects caption tampering", () => {
    const record = proposedRecord();
    const contents = serializeManifest(header(), [
      record,
      {
        ...record,
        image: image("image-002"),
        ordinal: "2",
        result: { status: "failed", reason: "image unreadable" },
      },
    ]);

    const parsed = parseManifest(contents);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.summary).toMatchObject({ proposed: 1, failed: 1, total: 2 });

    expect(() =>
      parseManifest(contents.replace("米白色陶瓷杯", "灰白色陶瓷杯")),
    ).toThrow(/checksum/i);
  });

  it("preserves a failure record for an active row with no storage identity", () => {
    const record = proposedRecord();
    const contents = serializeManifest(header(), [
      {
        ...record,
        image: image("image-without-storage", "legacy", { storagePath: "" }),
        ordinal: null,
        result: { status: "failed", reason: "missing storage identity" },
      },
    ]);

    expect(parseManifest(contents).records[0]).toMatchObject({
      image: { id: "image-without-storage", storagePath: "" },
      result: { status: "failed", reason: "missing storage identity" },
    });
  });

  it("rejects unsupported versions and a manifest from another Supabase project", () => {
    const contents = serializeManifest(header(), [proposedRecord()]);
    const lines = contents.trimEnd().split("\n");
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    first.manifestVersion = MANIFEST_VERSION + 1;
    lines[0] = JSON.stringify(first);

    expect(() => parseManifest(`${lines.join("\n")}\n`)).toThrow(/version/i);

    const parsed = parseManifest(contents);
    expect(() =>
      assertManifestEnvironment(parsed, {
        projectRef: "production-project-ref",
        host: "production-project-ref.supabase.co",
      }),
    ).toThrow(/another Supabase project/i);
  });
});

describe("safe apply planning", () => {
  const record = proposedRecord();

  it("plans an alt-only conditional write", () => {
    expect(buildAltOnlyUpdate(record)).toEqual({
      values: { alt_zh: CAPTION_A },
      conditions: {
        id: "image-001",
        brand_id: "5e58c6aa-f2d9-42dd-8e9c-450d8e2fa4dd",
        status: "active",
        alt_zh: null,
        storage_path:
          "brands/5e58c6aa-f2d9-42dd-8e9c-450d8e2fa4dd/image-001.webp",
      },
    });
  });

  it("distinguishes idempotency from replacement, changed text, and lost eligibility", () => {
    const current = {
      id: record.image.id,
      brand_id: record.image.brandId,
      status: "active",
      storage_path: record.image.storagePath,
      alt_zh: null,
    };

    expect(classifyApplyState(record, current)).toBe("write");
    expect(classifyApplyState(record, { ...current, alt_zh: CAPTION_A })).toBe(
      "idempotent",
    );
    expect(
      classifyApplyState(record, {
        ...current,
        storage_path: current.storage_path.replace("image-001", "replacement"),
      }),
    ).toBe("replaced");
    expect(classifyApplyState(record, { ...current, alt_zh: CAPTION_B })).toBe(
      "changed",
    );
    expect(classifyApplyState(record, { ...current, status: "rejected" })).toBe(
      "no_longer_eligible",
    );
    expect(classifyApplyState(record, null)).toBe("no_longer_eligible");
  });
});
