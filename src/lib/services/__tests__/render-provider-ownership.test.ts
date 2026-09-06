import { describe, expect, it, vi } from "vitest";
import {
  resolveRenderProvider,
  releaseRenderProvider,
} from "../render-provider-ownership";
import type { BudgetWrappedProvider } from "../enrich-phases/scraper/render/render-budget";

function stubProvider(overrides?: Partial<BudgetWrappedProvider>): BudgetWrappedProvider {
  return {
    fetchRendered: vi.fn(async () => ({ html: "", finalUrl: "", status: 200 })),
    fetchRenderedBatch: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("resolveRenderProvider", () => {
  it("resolveRenderProvider_uses_injected_provider_and_does_not_own_it", () => {
    const injected = stubProvider();
    const factory = vi.fn();
    const handle = resolveRenderProvider(
      { renderProvider: injected },
      factory,
    );

    expect(handle.provider).toBe(injected);
    expect(handle.owned).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it("resolveRenderProvider_creates_when_absent_and_owns_it", () => {
    const created = stubProvider();
    const factory = vi.fn(() => created);
    const handle = resolveRenderProvider({}, factory);

    expect(handle.provider).toBe(created);
    expect(handle.owned).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
  });
});

describe("releaseRenderProvider", () => {
  it("releaseRenderProvider_closes_only_owned", async () => {
    const close = vi.fn(async () => {});
    const injected = stubProvider({ close });

    // owned: false — never calls close
    await releaseRenderProvider({ provider: injected, owned: false });
    expect(close).not.toHaveBeenCalled();

    // owned: true — calls close once
    await releaseRenderProvider({ provider: injected, owned: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it("releaseRenderProvider_swallows_rejected_close", async () => {
    const close = vi.fn(async () => {
      throw new Error("browser already closed");
    });
    const provider = stubProvider({ close });

    // Must not throw
    await expect(
      releaseRenderProvider({ provider, owned: true }),
    ).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
