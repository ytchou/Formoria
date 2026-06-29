// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Brand } from "@/lib/types/brand"

vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "test@example.com" } }, error: null }) } }) }))
vi.mock("@/lib/services/brands", () => ({ getBrandBySlug: vi.fn() }))
vi.mock("@/lib/services/brand-owners", () => ({ getUserBrands: vi.fn() }))
vi.mock("@/lib/services/brand-analytics", () => ({
  getAnalytics: vi.fn(async () => ({ totalViews: 100, totalClicks: 5, viewTrend: "up", clickTrend: "flat", ctr: 0.05, ctrTrend: "up" })),
}))
vi.mock("@/lib/services/brand-completeness", () => ({
  computeBrandCompleteness: vi.fn(() => ({ total: 7, completed: 3, fraction: 3 / 7, items: [], tier1Items: [], tier2Items: [] })),
}))
vi.mock("@/lib/services/brand-health", () => ({
  computeBrandHealth: vi.fn(() => ({ overall: 58, tier: "growing", dimensions: [], topActions: [] })),
}))
vi.mock("@/components/dashboard/brand-health-card", () => ({ BrandHealthCard: () => <div data-testid="brand-health-card" /> }))

import { getBrandBySlug } from "@/lib/services/brands"
import { getUserBrands } from "@/lib/services/brand-owners"
import HealthPage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUserBrands).mockResolvedValue([{ brandId: "b1", brandName: "Test", brandSlug: "test", heroImageUrl: null, claimedAt: "2026-01-01" }])
  vi.mocked(getBrandBySlug).mockResolvedValue({ id: "b1", name: "Test", slug: "test", status: "approved", createdAt: "2026-01-01T00:00:00Z" } as unknown as Brand)
})

describe("HealthPage", () => {
  it("renders the brand health card", async () => {
    render(await HealthPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ brand: "test" }) }))

    expect(screen.getByTestId("brand-health-card")).toBeInTheDocument()
  })
})
