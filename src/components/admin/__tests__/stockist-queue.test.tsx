// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import type { PendingStockist } from "@/lib/services/stockists";

// The queue imports the server action directly rather than taking it as a prop,
// so the module has to be replaced or the whole admin action graph loads into
// jsdom. Not a service or a Supabase client, so `check-test-boundaries.mjs` is
// satisfied.
vi.mock("@/app/admin/actions", () => ({
  reviewStockistAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { StockistQueue } from "../stockist-queue";

function pendingStockist(
  overrides: Partial<PendingStockist> & { id: string; name: string },
): PendingStockist {
  return {
    brandId: "8d2b6f14-3c07-4e9a-b5d1-0f6a2c7e9b43",
    brandSlug: "formoria-studio",
    brandName: "Formoria Studio",
    regionLabel: "臺北市",
    address: "臺北市大同區迪化街一段94號",
    url: null,
    submittedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function renderQueue(stockists: PendingStockist[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StockistQueue stockists={stockists} />
    </NextIntlClientProvider>,
  );
}

describe("StockistQueue", () => {
  // The two empty states say different things — nothing to review is good news,
  // a search that matches nothing is a dead end the reviewer can back out of —
  // and the component picks between them with a ternary on the unfiltered list.
  // Neither branch had a test that rendered anything.
  it("says the queue is empty when nothing is waiting for review", () => {
    renderQueue([]);

    expect(
      screen.getByText(messages.admin.stockists.empty),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(messages.admin.stockists.notFound),
    ).not.toBeInTheDocument();
  });

  it("says the search matched nothing when rows exist but none match", async () => {
    const user = userEvent.setup();
    renderQueue([
      pendingStockist({
        id: "0f4c9a71-5b2e-4d38-8c16-7a0e3b9d5f42",
        name: "誠品書店 信義店",
      }),
    ]);

    await user.type(
      screen.getByRole("textbox", {
        name: messages.admin.stockists.searchLabel,
      }),
      "no such stockist",
    );

    expect(
      screen.getByText(messages.admin.stockists.notFound),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(messages.admin.stockists.empty),
    ).not.toBeInTheDocument();
  });

  // `ReviewQueueTable` always emits `aria-controls` on the expand control, so
  // the id it names must be the id the drawer body renders. Passing only one of
  // the pair points assistive tech at a region that does not exist.
  it("points the expand control at the drawer body it opens", async () => {
    const user = userEvent.setup();
    const stockist = pendingStockist({
      id: "1a7d2e63-9c40-4b85-a2f7-6e51c8b3d097",
      name: "小器生活",
    });
    renderQueue([stockist]);

    const disclosure = screen.getByRole("button", {
      name: messages.admin.stockists.expandStockist.replace(
        "{name}",
        stockist.name,
      ),
    });
    const controlledId = disclosure.getAttribute("aria-controls");
    if (!controlledId) throw new Error("the expand control has no aria-controls");

    await user.click(disclosure);

    await waitFor(() => {
      expect(document.getElementById(controlledId)).not.toBeNull();
    });
  });
});
