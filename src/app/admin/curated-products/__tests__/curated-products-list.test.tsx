// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import { CuratedProductsList } from "../curated-products-list";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const actions = vi.hoisted(() => ({ retire: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/admin/curated-products",
}));
vi.mock("@/app/admin/curated-products/actions", () => ({
  retireCuratedProductAction: actions.retire,
}));
// The editor is a separate unit with its own suite; stubbing it keeps this test
// about the queue's tabs, rows and controls.
vi.mock("../curated-product-editor", () => ({
  CuratedProductEditor: () => <div>curated-product-editor</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  actions.retire.mockResolvedValue(undefined);
});

describe("CuratedProductsList", () => {
  it("shows two tabs and routes ?stage= to each", async () => {
    const user = userEvent.setup();
    renderList([
      makeProduct({ id: "a", nameZh: "看得見的商品", visible: true }),
      makeProduct({ id: "b", nameZh: "隱藏的商品", visible: false }),
    ]);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Visible (1)",
      "Hidden (1)",
    ]);

    await user.click(screen.getByRole("tab", { name: /^Hidden/ }));
    expect(navigation.replace).toHaveBeenCalledWith(
      "/admin/curated-products?stage=hidden",
    );

    await user.click(screen.getByRole("tab", { name: /^Visible/ }));
    expect(navigation.replace).toHaveBeenCalledWith(
      "/admin/curated-products?stage=visible",
    );
  });

  it("the visible tab lists only visible products", () => {
    renderList([
      makeProduct({ id: "a", nameZh: "看得見的商品", visible: true }),
      makeProduct({ id: "b", nameZh: "隱藏的商品", visible: false }),
    ]);

    expect(screen.getByText("看得見的商品")).toBeInTheDocument();
    expect(screen.queryByText("隱藏的商品")).not.toBeInTheDocument();
  });

  it("the hidden tab lists only hidden products", () => {
    renderList(
      [
        makeProduct({ id: "a", nameZh: "看得見的商品", visible: true }),
        makeProduct({ id: "b", nameZh: "隱藏的商品", visible: false }),
      ],
      "hidden",
    );

    expect(screen.getByText("隱藏的商品")).toBeInTheDocument();
    expect(screen.queryByText("看得見的商品")).not.toBeInTheDocument();
  });

  it("offers no bulk promote control", () => {
    renderList([makeProduct({ id: "a", nameZh: "看得見的商品" })]);

    // No selection column, so no row or select-all checkbox …
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // … and no action that would consume a selection.
    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
  });

  it("renders a visible badge per row", () => {
    renderList([
      makeProduct({ id: "a", nameZh: "看得見的商品", visible: true }),
      makeProduct({ id: "b", nameZh: "隱藏的商品", visible: false }),
    ]);

    expect(
      screen.getByRole("columnheader", { name: "Visible" }),
    ).toBeInTheDocument();
    expect(within(rowFor("看得見的商品")).getByText("Visible")).toBeInTheDocument();

    renderHiddenTab();
    expect(within(rowFor("隱藏的商品")).getByText("Hidden")).toBeInTheDocument();
  });
});

function renderHiddenTab() {
  renderList(
    [makeProduct({ id: "b", nameZh: "隱藏的商品", visible: false })],
    "hidden",
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name).closest("tr");
  if (!cell) throw new Error(`No row rendered for ${name}`);
  return cell;
}

function makeProduct(
  overrides: Partial<AdminCuratedProduct> & { id: string },
): AdminCuratedProduct {
  return {
    brandId: "brand-1",
    brandSlug: "brand-one",
    brandName: "品牌一",
    key: `key-${overrides.id}`,
    nameZh: "商品",
    nameEn: null,
    category: "food",
    subcategories: [],
    officialUrl: "https://brand.example.com/product",
    imageUrl: "https://cdn.example.com/product.webp",
    imageSourceUrl: "https://brand.example.com/product",
    visible: true,
    linkState: "ok",
    proposedBy: "admin",
    sourceCheckedAt: "2026-08-01T00:00:00.000Z",
    reviewDueAt: null,
    productDescriptionZh: "描述",
    productDescriptionEn: null,
    productPosition: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    sources: [],
    selections: [],
    ...overrides,
  };
}

function renderList(
  products: AdminCuratedProduct[],
  initialTab: "visible" | "hidden" = "visible",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CuratedProductsList
        products={products}
        brands={[{ id: "brand-1", slug: "brand-one", name: "品牌一" }]}
        initialTab={initialTab}
      />
    </NextIntlClientProvider>,
  );
}
