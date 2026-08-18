// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import {
  CuratedProductEditor,
  type TrailOption,
} from "../curated-product-editor";

/**
 * The server actions are POST endpoints ("use server"), so the module is
 * replaced rather than imported: this suite renders the FORM, and a real action
 * would need an authenticated request and a database. Mocking the action module
 * is allowed by `scripts/check-test-boundaries.mjs`; mocking a service is not.
 */
vi.mock("@/app/admin/curated-products/actions", () => ({
  createCuratedProductAction: vi.fn(),
  prefillCuratedProductAction: vi.fn(),
  retireCuratedProductSelectionAction: vi.fn(),
  retireCuratedProductSourceAction: vi.fn(),
  upsertCuratedProductSelectionAction: vi.fn(),
  updateCuratedProductAction: vi.fn(),
}));

const BRAND = {
  id: "8f4c2b1e-5a90-4d37-9c68-1b7e0a3d5f42",
  slug: "kiln-and-clay",
  name: "Kiln & Clay",
};

const TRAILS: TrailOption[] = [
  {
    slug: "small-space-reading-corner",
    title: "A reading corner in a small home",
    sections: [{ key: "light-first", title: "Light first" }],
    blockers: [],
    placementReadError: false,
  },
];

function product(
  overrides: Partial<AdminCuratedProduct> = {},
): AdminCuratedProduct {
  return {
    id: "1d9a7c30-62b5-4f18-8ae2-0c3f95d6b471",
    brandId: BRAND.id,
    brandSlug: BRAND.slug,
    brandName: BRAND.name,
    key: "ceramic-teacup",
    nameZh: "Ceramic teacup",
    nameEn: "Ceramic teacup",
    l1: "home",
    l2: ["tableware"],
    officialUrl: "https://kilnandclay.example.com/teacup",
    imageUrl: null,
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    proposedBy: "admin",
    sourceCheckedAt: "2026-08-01T00:00:00.000Z",
    reviewDueAt: null,
    productDescriptionZh: "A thrown stoneware cup that holds about 200 ml.",
    productDescriptionEn: null,
    productPosition: 3,
    updatedAt: "2026-08-01T00:00:00.000Z",
    sources: [],
    selections: [],
    ...overrides,
  };
}

function renderEditor(overrides: Partial<AdminCuratedProduct> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CuratedProductEditor
        mode="edit"
        product={product(overrides)}
        brands={[BRAND]}
        trailOptions={TRAILS}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("CuratedProductEditor", () => {
  it("renders no wall-position or image-rights control", () => {
    const { container } = renderEditor();

    expect(screen.queryByLabelText(/homepage wall position/i)).toBeNull();
    expect(screen.queryByLabelText(/image rights/i)).toBeNull();
    // Nothing may still POINT at a removed input either: an orphaned
    // `aria-describedby` or `htmlFor` is silent on screen and broken in a
    // screen reader.
    expect(container.querySelector('[id*="wall-position"]')).toBeNull();
    expect(container.querySelector('[id*="image-usage"]')).toBeNull();
    for (const element of container.querySelectorAll("[aria-describedby]")) {
      for (const id of (
        element.getAttribute("aria-describedby") ?? ""
      ).split(/\s+/)) {
        expect(container.querySelector(`#${CSS.escape(id)}`)).not.toBeNull();
      }
    }
    for (const label of container.querySelectorAll("label[for]")) {
      const id = label.getAttribute("for") ?? "";
      expect(container.querySelector(`#${CSS.escape(id)}`)).not.toBeNull();
    }
  });

  it("renders the product-position input with its label and error wiring", () => {
    const { container } = renderEditor();

    const input = screen.getByLabelText(
      messages.admin.curatedProducts.editor.productPosition,
    );
    expect(input).toHaveValue(3);
    expect(input.id).toContain("product-position");
    // No error is showing, so the field must not advertise one.
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(
      container.querySelector(`label[for="${CSS.escape(input.id)}"]`),
    ).not.toBeNull();
  });

  it("offers no promote action", () => {
    const { container } = renderEditor();

    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
    expect(screen.queryByRole("status", { name: /publish/i })).toBeNull();
    expect(container.textContent).not.toMatch(/promote/i);
    expect(container.textContent).not.toMatch(/publishing conditions/i);
  });

  it("every rendered i18n key resolves", () => {
    const { container } = renderEditor();

    // next-intl renders the dotted key path when a message is missing, so a
    // deleted catalogue entry leaks as literal `admin.curatedProducts.…` text.
    expect(container.textContent).not.toMatch(/admin\.curatedProducts/);
    expect(container.textContent).not.toMatch(/editor\.[a-zA-Z]/);
  });
});
