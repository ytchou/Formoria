// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WallTileSlot } from "@/lib/curated-products/wall-tile";

// The lazy chunk's real tile is covered by the WallGroupGrid tests in
// `curated-product-grid.test.tsx`; here it only has to show what it received.
vi.mock("@/components/landing/wall-group-grid", () => ({
  WallGroupGrid: ({ slug, slots }: { slug: string; slots: WallTileSlot[] }) => (
    <div data-category={slug}>
      <ul>
        {slots.map((slot) => (
          <li key={slot.product.key}>{slot.product.nameZh}</li>
        ))}
      </ul>
    </div>
  ),
}));

import { CategoryFilter } from "../category-filter";

const LABELS = {
  tile: { cta: "看商品", brandSiteCta: "品牌網站", unavailable: "暫無" },
  loading: "載入中…",
  loadFailed: "這個分類暫時載不出來。",
  retry: "再試一次",
};

const CATEGORIES = [
  { slug: "all", label: "全部" },
  { slug: "home", label: "居家生活" },
  { slug: "beauty", label: "美妝保養" },
];

function slot(key: string, nameZh: string): WallTileSlot {
  return {
    product: {
      id: `id-${key}`,
      key,
      nameZh,
      nameEn: null,
      productDescriptionZh: "描述",
      productDescriptionEn: null,
      imageUrl: null,
      subcategory: "tableware",
      category: "home",
      linkState: "ok",
      officialUrl: null,
      mitQualified: false,
      brandSlug: `brand-${key}`,
      brandName: `品牌 ${key}`,
      brand: {
        slug: `brand-${key}`,
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        purchaseMyship: null,
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
      },
    },
  };
}

function okResponse(slots: WallTileSlot[]) {
  return { ok: true, status: 200, json: async () => ({ slots }) } as Response;
}

const failedResponse = {
  ok: false,
  status: 503,
  json: async () => ({ error: "home_wall_unavailable" }),
} as Response;

/** A fetch whose responses the test releases one at a time. */
function deferredFetch() {
  const pending: {
    url: string;
    signal?: AbortSignal;
    resolve: (response: Response) => void;
  }[] = [];
  const fn = vi.fn(
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        pending.push({ url, signal: init?.signal ?? undefined, resolve });
      }),
  );
  return { fn, pending };
}

function renderFilter() {
  return render(
    <CategoryFilter categories={CATEGORIES} locale="zh-TW" labels={LABELS}>
      <div data-category="all">
        <ul>
          <li>伺服器商品</li>
        </ul>
      </div>
    </CategoryFilter>,
  );
}

function allGroup(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-category="all"]')!;
}

let fetchMock: ReturnType<typeof deferredFetch>;

beforeEach(() => {
  fetchMock = deferredFetch();
  vi.stubGlobal("fetch", fetchMock.fn);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CategoryFilter", () => {
  it("shows the server group and fetches nothing until a chip is chosen", () => {
    const { container } = renderFilter();

    expect(allGroup(container).hidden).toBe(false);
    expect(screen.getByText("伺服器商品")).toBeInTheDocument();
    expect(fetchMock.fn).not.toHaveBeenCalled();
  });

  it("fetches a category once, shows placeholders while pending, then its tiles", async () => {
    const user = userEvent.setup();
    const { container } = renderFilter();
    const chip = screen.getByRole("button", { name: "居家生活" });

    await user.click(chip);

    expect(fetchMock.fn).toHaveBeenCalledTimes(1);
    expect(fetchMock.fn.mock.calls[0]![0]).toBe("/api/home-wall?category=home");
    expect(allGroup(container).hidden).toBe(true);

    const busy = container.querySelector('[data-category="home"][aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy!.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(10);
    expect(screen.getByRole("status")).toHaveTextContent("載入中…");

    fetchMock.pending[0]!.resolve(okResponse([slot("cup", "陶土馬克杯")]));

    expect(await screen.findByText("陶土馬克杯")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(chip).toHaveFocus();
  });

  it("returns to the server group on all, and re-selecting does not refetch", async () => {
    const user = userEvent.setup();
    const { container } = renderFilter();

    await user.click(screen.getByRole("button", { name: "居家生活" }));
    fetchMock.pending[0]!.resolve(okResponse([slot("cup", "陶土馬克杯")]));
    await screen.findByText("陶土馬克杯");

    await user.click(screen.getByRole("button", { name: "全部" }));
    expect(allGroup(container).hidden).toBe(false);
    expect(screen.queryByText("陶土馬克杯")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "居家生活" }));
    expect(await screen.findByText("陶土馬克杯")).toBeInTheDocument();
    expect(allGroup(container).hidden).toBe(true);
    expect(fetchMock.fn).toHaveBeenCalledTimes(1);
  });

  it("shows a message and a retry that refetches when the request fails", async () => {
    const user = userEvent.setup();
    renderFilter();

    await user.click(screen.getByRole("button", { name: "居家生活" }));
    fetchMock.pending[0]!.resolve(failedResponse);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "這個分類暫時載不出來。",
    );

    await user.click(screen.getByRole("button", { name: "再試一次" }));
    expect(fetchMock.fn).toHaveBeenCalledTimes(2);
    expect(fetchMock.fn.mock.calls[1]![0]).toBe("/api/home-wall?category=home");

    fetchMock.pending[1]!.resolve(okResponse([slot("cup", "陶土馬克杯")]));
    expect(await screen.findByText("陶土馬克杯")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts a superseded request and never renders its response", async () => {
    const user = userEvent.setup();
    renderFilter();

    await user.click(screen.getByRole("button", { name: "居家生活" }));
    await user.click(screen.getByRole("button", { name: "美妝保養" }));

    expect(fetchMock.pending[0]!.signal?.aborted).toBe(true);
    expect(fetchMock.fn.mock.calls[1]![0]).toBe(
      "/api/home-wall?category=beauty",
    );

    fetchMock.pending[1]!.resolve(okResponse([slot("soap", "手工皂")]));
    expect(await screen.findByText("手工皂")).toBeInTheDocument();
    // The aborted request settled as an AbortError, not as this group's error.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("renders an empty grid for an empty category", async () => {
    const user = userEvent.setup();
    const { container } = renderFilter();

    await user.click(screen.getByRole("button", { name: "居家生活" }));
    fetchMock.pending[0]!.resolve(okResponse([]));

    await waitFor(() =>
      expect(
        container.querySelector('[data-category="home"]:not([aria-busy]) ul'),
      ).not.toBeNull(),
    );
    expect(
      container.querySelectorAll('[data-category="home"] li'),
    ).toHaveLength(0);
  });
});
