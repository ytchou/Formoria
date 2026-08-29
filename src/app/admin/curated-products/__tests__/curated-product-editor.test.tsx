// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import type { TrailAuthoringWarning } from "@/lib/services/trail-authoring";
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
const actions = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/app/admin/curated-products/actions", () => ({
  createCuratedProductAction: actions.create,
  prefillCuratedProductAction: vi.fn(),
  retireCuratedProductSelectionAction: vi.fn(),
  retireCuratedProductSourceAction: vi.fn(),
  upsertCuratedProductSelectionAction: vi.fn(),
  updateCuratedProductAction: actions.update,
}));

beforeEach(() => {
  vi.clearAllMocks();
  actions.create.mockResolvedValue(undefined);
  actions.update.mockResolvedValue(undefined);
});

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
    warnings: [],
    placementReadError: false,
  },
];

function trailsWithWarnings(warnings: TrailAuthoringWarning[]): TrailOption[] {
  return TRAILS.map((trail) => ({ ...trail, warnings }));
}

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
    category: "home",
    subcategory: "tableware",
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

function renderEditor(
  overrides: Partial<AdminCuratedProduct> = {},
  trailOptions: TrailOption[] = TRAILS,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CuratedProductEditor
        mode="edit"
        product={product(overrides)}
        brands={[BRAND]}
        trailOptions={trailOptions}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function renderCreate() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CuratedProductEditor
        mode="create"
        brands={[BRAND]}
        defaultBrandId={BRAND.id}
        trailOptions={TRAILS}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

const VISIBLE_LABEL = messages.admin.curatedProducts.editor.visible;

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
      for (const id of (element.getAttribute("aria-describedby") ?? "").split(
        /\s+/,
      )) {
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

  // Bug caught: generic Category/Subcategories copy hid the L1/L2 taxonomy
  // distinction on the product editor and made the active contract ambiguous.
  it("uses explicit L1/L2 vocabulary for category controls", () => {
    renderEditor();

    expect(messages.admin.curatedProducts.editor.l1).toBe("Product category");
    expect(messages.admin.curatedProducts.editor.l2).toBe(
      "Product subcategory",
    );
    expect(screen.getByLabelText("Product category")).toBeInTheDocument();
    expect(screen.getByText("Product subcategory")).toBeInTheDocument();
  });

  it("offers no promote action", () => {
    const { container } = renderEditor();

    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
    expect(screen.queryByRole("status", { name: /publish/i })).toBeNull();
    expect(container.textContent).not.toMatch(/promote/i);
    expect(container.textContent).not.toMatch(/publishing conditions/i);
  });

  /**
   * The promote path was deleted with `lifecycle`, and nothing replaced it: the
   * editor read `visible` and never wrote it, so no surface in the product
   * could publish a curated product at all (DEV-1485).
   */
  it("publishes a hidden product by sending visible in the update payload", async () => {
    const user = userEvent.setup();
    renderEditor({ visible: false });

    const control = screen.getByLabelText(VISIBLE_LABEL);
    expect(control).not.toBeChecked();

    await user.click(control);
    expect(control).toBeChecked();

    await user.click(
      screen.getByRole("button", {
        name: messages.admin.curatedProducts.editor.save,
      }),
    );

    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    expect(actions.update.mock.calls[0]?.[0]).toBe(product().id);
    expect(actions.update.mock.calls[0]?.[1]).toMatchObject({ visible: true });
  });

  it("unpublishes a visible product by sending visible: false", async () => {
    const user = userEvent.setup();
    renderEditor({ visible: true });

    const control = screen.getByLabelText(VISIBLE_LABEL);
    expect(control).toBeChecked();

    await user.click(control);
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.curatedProducts.editor.save,
      }),
    );

    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    expect(actions.update.mock.calls[0]?.[1]).toMatchObject({ visible: false });
  });

  it("a new product defaults to hidden", async () => {
    const user = userEvent.setup();
    renderCreate();

    // Publication stays a deliberate act: the box starts clear, and a create
    // that never touches it posts `visible: false` rather than relying on the
    // column default, which publishes.
    const control = screen.getByLabelText(VISIBLE_LABEL);
    expect(control).not.toBeChecked();

    await user.type(
      screen.getByLabelText(messages.admin.curatedProducts.editor.nameZh),
      "陶土茶杯",
    );
    await user.type(
      screen.getByLabelText(
        messages.admin.curatedProducts.editor.productDescriptionZh,
      ),
      "陶土燒製，容量約 200 毫升。",
    );
    await user.click(
      screen.getByRole("button", {
        name: messages.admin.curatedProducts.editor.create,
      }),
    );

    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    expect(actions.create.mock.calls[0]?.[0]).toMatchObject({ visible: false });
  });

  it("labels the visibility control and points its hint at a real element", () => {
    const { container } = renderEditor();

    const control = screen.getByLabelText(VISIBLE_LABEL);
    expect(control.id).toContain("visible");
    expect(
      container.querySelector(`label[for="${CSS.escape(control.id)}"]`),
    ).not.toBeNull();
    const hintId = control.getAttribute("aria-describedby") ?? "";
    expect(container.querySelector(`#${CSS.escape(hintId)}`)?.textContent).toBe(
      messages.admin.curatedProducts.editor.visibleHint,
    );
  });

  /**
   * The panel is an AUTHORING readout, not a gate: it never blocks a save, and
   * nothing it lists changes what a visitor sees. Each warning is its own list
   * item so an editor can read them one at a time.
   */
  it("renders the before publishing panel with warnings", () => {
    renderEditor({}, trailsWithWarnings(["draft", "unplaced_section"]));

    const heading = screen.getByText(
      messages.admin.curatedProducts.editor.placement.blockersTitle,
    );
    const items = [
      ...(heading.parentElement?.querySelectorAll("li") ?? []),
    ].map((item) => item.textContent);
    expect(items).toEqual(["draft", "unplaced_section"]);
  });

  it("renders no panel when there are no warnings", () => {
    renderEditor({}, trailsWithWarnings([]));

    expect(
      screen.queryByText(
        messages.admin.curatedProducts.editor.placement.blockersTitle,
      ),
    ).toBeNull();
  });

  it("every rendered i18n key resolves", () => {
    const { container } = renderEditor();

    // next-intl renders the dotted key path when a message is missing, so a
    // deleted catalogue entry leaks as literal `admin.curatedProducts.…` text.
    expect(container.textContent).not.toMatch(/admin\.curatedProducts/);
    expect(container.textContent).not.toMatch(/editor\.[a-zA-Z]/);
  });
});
