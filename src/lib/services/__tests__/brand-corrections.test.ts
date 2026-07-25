import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  rateLimit: vi.fn(),
  updateBrand: vi.fn(),
  revalidatePublicBrand: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock("@/lib/security/rate-limiter", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("../brands", () => ({
  updateBrand: mocks.updateBrand,
}));

vi.mock("@/lib/cache/public-brand-cache", () => ({
  revalidatePublicBrand: mocks.revalidatePublicBrand,
}));

import { deriveProductTagsEn } from "@/lib/services/product-tags";
import { createServiceClient } from "@/lib/supabase/server";
import {
  listCorrections,
  reviewCorrection,
  submitCorrection,
  type BrandCorrection,
} from "../brand-corrections";

type DbError = {
  code?: string;
  message?: string;
} | null;

type QueryResponse = {
  data?: unknown;
  count?: number | null;
  error: DbError;
};

type QueryBuilder = QueryResponse & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: Promise<QueryResponse>["then"];
};

function makeBuilder(response: QueryResponse): QueryBuilder {
  const builder = {
    ...response,
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn(async () => response),
    single: vi.fn(async () => response),
    then: undefined,
  } as unknown as QueryBuilder;

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.range.mockReturnValue(builder);
  builder.insert.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.delete.mockReturnValue(builder);
  builder.then = ((onfulfilled, onrejected) =>
    Promise.resolve(response).then(
      onfulfilled,
      onrejected,
    )) as QueryBuilder["then"];

  return builder;
}

function mockClient(
  routes: Record<string, QueryBuilder[]>,
): ReturnType<typeof vi.fn> {
  const from = vi.fn((table: string) => {
    const builder = routes[table]?.shift();
    if (!builder) throw new Error(`Unexpected Supabase query for ${table}`);
    return builder;
  });

  mocks.createServiceClient.mockReturnValue({ from } as unknown as ReturnType<
    typeof createServiceClient
  >);
  return from;
}

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  price_range: number | null;
  product_type: string | null;
  product_tags: string[] | null;
};

function brandRow(overrides: Partial<BrandRow> = {}): BrandRow {
  return {
    id: "brand-1",
    name: "Test Brand",
    slug: "test-brand",
    price_range: 2,
    product_type: "fashion",
    product_tags: ["耳環"],
    ...overrides,
  };
}

type CorrectionRow = {
  id: string;
  brand_id: string;
  field: string;
  proposed_value: unknown;
  previous_value: unknown;
  visitor_hash: string | null;
  status: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewer_notes: string | null;
  created_at: string;
  brands: BrandRow | null;
};

function correctionRow(overrides: Partial<CorrectionRow> = {}): CorrectionRow {
  return {
    id: "correction-1",
    brand_id: "brand-1",
    field: "price_range",
    proposed_value: 3,
    previous_value: 2,
    visitor_hash: "visitor-1",
    status: "pending",
    reviewed_at: null,
    reviewed_by: null,
    reviewer_notes: null,
    created_at: "2026-07-25T00:00:00.000Z",
    brands: brandRow(),
    ...overrides,
  };
}

function correctionInput(overrides: Record<string, unknown> = {}) {
  return {
    brandId: "brand-1",
    field: "price_range",
    proposedValue: 3,
    visitorHash: "visitor-1",
    ...overrides,
  };
}

function setupReview(
  row: CorrectionRow,
  ...mutationBuilders: QueryBuilder[]
): { lookup: QueryBuilder; mutations: QueryBuilder[] } {
  const lookup = makeBuilder({ data: row, error: null });
  mockClient({
    brand_field_corrections: [lookup, ...mutationBuilders],
  });
  return { lookup, mutations: mutationBuilders };
}

describe("brand corrections service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: 0,
    });
    mocks.updateBrand.mockResolvedValue({ slug: "test-brand" });
  });

  it("rejects unknown field name", async () => {
    await expect(
      submitCorrection(correctionInput({ field: "unknown_field" })),
    ).resolves.toEqual({ ok: false, code: "invalid_field" });
  });

  it("rejects price_range outside 1..3", async () => {
    for (const proposedValue of [0, 4, 1.5]) {
      await expect(
        submitCorrection(correctionInput({ proposedValue })),
      ).resolves.toEqual({ ok: false, code: "invalid_value" });
    }
  });

  it("rejects product_type slug not in PRODUCT_TYPE_CATEGORIES", async () => {
    await expect(
      submitCorrection(
        correctionInput({
          field: "product_type",
          proposedValue: "not-a-category",
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_value" });
  });

  it("rejects product_tags deltas containing a non-canonical string", async () => {
    // add array validated
    await expect(
      submitCorrection(
        correctionInput({
          field: "product_tags",
          proposedValue: { add: ["not-an-ontology-label"], remove: [] },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_value" });

    // remove array validated too
    await expect(
      submitCorrection(
        correctionInput({
          field: "product_tags",
          proposedValue: { add: [], remove: ["not-an-ontology-label"] },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_value" });

    // L2 slug ("earrings") is rejected — only nameZh ("耳環") is canonical
    await expect(
      submitCorrection(
        correctionInput({
          field: "product_tags",
          proposedValue: { add: ["earrings"], remove: [] },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_value" });
  });

  it("rejects an empty delta", async () => {
    const brand = makeBuilder({
      data: brandRow({ product_tags: [] }),
      error: null,
    });
    mockClient({ brands: [brand] });

    await expect(
      submitCorrection(
        correctionInput({
          field: "product_tags",
          proposedValue: { add: [], remove: [] },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "unchanged" });
  });

  it("rejects a delta with no net effect", async () => {
    const brand = makeBuilder({
      data: brandRow({ product_tags: ["耳環"] }),
      error: null,
    });
    mockClient({ brands: [brand] });

    await expect(
      submitCorrection(
        correctionInput({
          field: "product_tags",
          proposedValue: { add: ["耳環"], remove: ["托特包"] },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "unchanged" });
  });

  it("rejects a delta whose projected result exceeds MAX_PRODUCT_TAGS at submit time", async () => {
    const brand = makeBuilder({
      data: brandRow({ product_tags: ["耳環", "托特包", "斜背包", "外套"] }),
      error: null,
    });
    mockClient({ brands: [brand] });

    await expect(
      submitCorrection(
        correctionInput({
          field: "product_tags",
          proposedValue: { add: ["洋裝", "裙裝"], remove: [] },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "too_many_tags" });
  });

  it("rejects a no-op submission for scalar fields", async () => {
    const brand = makeBuilder({
      data: brandRow({ price_range: 2 }),
      error: null,
    });
    mockClient({ brands: [brand] });

    await expect(
      submitCorrection(correctionInput({ proposedValue: 2 })),
    ).resolves.toEqual({
      ok: false,
      code: "unchanged",
    });
  });

  it("maps pending-duplicate constraint violation to a typed error", async () => {
    const brand = makeBuilder({
      data: brandRow({ price_range: 2 }),
      error: null,
    });
    const insert = makeBuilder({
      data: null,
      error: { code: "23505", message: "duplicate pending correction" },
    });
    mockClient({ brands: [brand], brand_field_corrections: [insert] });

    await expect(submitCorrection(correctionInput())).resolves.toEqual({
      ok: false,
      code: "already_submitted",
    });
  });

  it("snapshots previous_value at submit time", async () => {
    const brand = makeBuilder({
      data: brandRow({ price_range: 1 }),
      error: null,
    });
    const insert = makeBuilder({ data: { id: "correction-1" }, error: null });
    mockClient({ brands: [brand], brand_field_corrections: [insert] });

    await expect(
      submitCorrection(correctionInput({ proposedValue: 3 })),
    ).resolves.toEqual({ ok: true, id: "correction-1" });
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: "brand-1",
        field: "price_range",
        proposed_value: 3,
        previous_value: 1,
        visitor_hash: "visitor-1",
        status: "pending",
      }),
    );
  });

  it("approval writes the field via updateBrand with an admin actor", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(correctionRow(), update);

    await expect(
      reviewCorrection("correction-1", "approved", "Looks correct", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateBrand).toHaveBeenCalledWith(
      "brand-1",
      { priceRange: 3 },
      { source: "admin", userId: "reviewer-1" },
    );
  });

  it("approval of product_tags writes both product_tags and product_tags_en", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(
      correctionRow({
        field: "product_tags",
        proposed_value: { add: ["托特包"], remove: [] },
        previous_value: ["耳環"],
      }),
      update,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "Canonical tag", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateBrand).toHaveBeenCalledWith(
      "brand-1",
      {
        productTags: ["耳環", "托特包"],
        productTagsEn: deriveProductTagsEn(["耳環", "托特包"]),
      },
      { source: "admin", userId: "reviewer-1" },
    );
  });

  it("approval applies the delta against the CURRENT value, not the snapshot", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(
      correctionRow({
        field: "product_tags",
        proposed_value: { add: ["斜背包"], remove: ["耳環"] },
        previous_value: ["耳環"],
        brands: brandRow({ product_tags: ["托特包"] }),
      }),
      update,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "Apply intent", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateBrand).toHaveBeenCalledWith(
      "brand-1",
      {
        productTags: ["托特包", "斜背包"],
        productTagsEn: deriveProductTagsEn(["托特包", "斜背包"]),
      },
      { source: "admin", userId: "reviewer-1" },
    );
  });

  it("approval tolerates a remove of an already-absent tag", async () => {
    const update = makeBuilder({ data: null, error: null });
    // brand has ["外套","洋裝"] — "耳環" is absent, so remove is a no-op;
    // "斜背包" is new, so it gets added. Distinct from the current-vs-snapshot test above.
    setupReview(
      correctionRow({
        field: "product_tags",
        proposed_value: { add: ["斜背包"], remove: ["耳環"] },
        previous_value: ["耳環"],
        brands: brandRow({ product_tags: ["外套", "洋裝"] }),
      }),
      update,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateBrand).toHaveBeenCalledWith(
      "brand-1",
      expect.objectContaining({ productTags: ["外套", "洋裝", "斜背包"] }),
      expect.objectContaining({ source: "admin" }),
    );
  });

  it("approval tolerates an add of an already-present tag", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(
      correctionRow({
        field: "product_tags",
        proposed_value: { add: ["耳環", "托特包"], remove: [] },
        previous_value: ["耳環"],
        brands: brandRow({ product_tags: ["耳環"] }),
      }),
      update,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateBrand).toHaveBeenCalledWith(
      "brand-1",
      expect.objectContaining({ productTags: ["耳環", "托特包"] }),
      expect.objectContaining({ source: "admin" }),
    );
  });

  it("approval fails when the merged result would exceed MAX_PRODUCT_TAGS", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(
      correctionRow({
        field: "product_tags",
        proposed_value: { add: ["洋裝", "裙裝"], remove: [] },
        previous_value: ["耳環"],
        brands: brandRow({
          product_tags: ["耳環", "托特包", "斜背包", "外套"],
        }),
      }),
      update,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: false, code: "too_many_tags" });
    expect(mocks.updateBrand).not.toHaveBeenCalled();
  });

  it("approval of a delta that has become a no-op fails cleanly", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(
      correctionRow({
        field: "product_tags",
        proposed_value: { add: ["耳環"], remove: ["托特包"] },
        previous_value: ["托特包"],
        brands: brandRow({ product_tags: ["耳環"] }),
      }),
      update,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: false, code: "unchanged" });
    expect(mocks.updateBrand).not.toHaveBeenCalled();
  });

  it("approval revalidates the public brand", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(correctionRow(), update);

    await reviewCorrection("correction-1", "approved", "", {
      reviewerId: "reviewer-1",
    });

    expect(mocks.revalidatePublicBrand).toHaveBeenCalledWith({
      slug: "test-brand",
    });
  });

  it("approving a product_type correction supersedes pending product_tags corrections", async () => {
    const update = makeBuilder({ data: null, error: null });
    const supersede = makeBuilder({ data: null, error: null });
    setupReview(
      correctionRow({
        field: "product_type",
        proposed_value: "beauty",
        previous_value: "fashion",
      }),
      update,
      supersede,
    );

    await expect(
      reviewCorrection("correction-1", "approved", "Category corrected", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(supersede.update).toHaveBeenCalledWith({
      status: "rejected",
      reviewed_at: expect.any(String),
      reviewed_by: "reviewer-1",
      reviewer_notes: "superseded_by_category_change",
    });
    expect(supersede.eq).toHaveBeenCalledWith("brand_id", "brand-1");
    expect(supersede.eq).toHaveBeenCalledWith("field", "product_tags");
    expect(supersede.eq).toHaveBeenCalledWith("status", "pending");
  });

  it("rejection does not call updateBrand", async () => {
    const update = makeBuilder({ data: null, error: null });
    setupReview(correctionRow(), update);

    await expect(
      reviewCorrection("correction-1", "rejected", "Not supported", {
        reviewerId: "reviewer-1",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updateBrand).not.toHaveBeenCalled();
    expect(update.update).toHaveBeenCalledWith({
      status: "rejected",
      reviewed_at: expect.any(String),
      reviewed_by: "reviewer-1",
      reviewer_notes: "Not supported",
    });
  });

  it("listCorrections flags stale rows", async () => {
    const list = makeBuilder({
      data: [
        correctionRow({
          id: "fresh",
          previous_value: 2,
          brands: brandRow({ price_range: 2 }),
        }),
        correctionRow({
          id: "stale",
          previous_value: 1,
          brands: brandRow({ price_range: 2 }),
        }),
      ],
      error: null,
    });
    mockClient({ brand_field_corrections: [list] });

    const corrections = await listCorrections();

    expect(corrections).toEqual([
      expect.objectContaining<Partial<BrandCorrection>>({
        id: "fresh",
        brandId: "brand-1",
        brandName: "Test Brand",
        brandSlug: "test-brand",
        currentValue: 2,
        stale: false,
      }),
      expect.objectContaining<Partial<BrandCorrection>>({
        id: "stale",
        brandId: "brand-1",
        brandName: "Test Brand",
        brandSlug: "test-brand",
        currentValue: 2,
        stale: true,
      }),
    ]);
  });
});
