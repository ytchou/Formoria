// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Brand } from "@/lib/types/brand"

vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "test@example.com" } }, error: null }) } }) }))
vi.mock("@/lib/services/brands", () => ({ getBrandBySlug: vi.fn() }))
vi.mock("@/lib/services/brand-owners", () => ({ getUserBrands: vi.fn() }))
vi.mock("@/lib/services/brand-analytics", () => ({
  getAnalytics: vi.fn(async () => ({ totalViews: 100, totalClicks: 5, viewTrend: "up", clickTrend: "flat", ctr: 0.05, ctrTrend: "up" })),
  getDailySeries: vi.fn(async () => []),
  getLinkClickBreakdown: vi.fn(async () => []),
  getSourceBreakdown: vi.fn(async () => []),
}))
vi.mock("@/components/dashboard/analytics-cards", () => ({ AnalyticsCards: () => <div data-testid="analytics-cards" /> }))
vi.mock("@/components/dashboard/analytics-chart", () => ({ AnalyticsChart: () => <div data-testid="analytics-chart" /> }))
vi.mock("@/components/dashboard/link-breakdown", () => ({ LinkBreakdown: () => <div data-testid="link-breakdown" /> }))
vi.mock("@/components/dashboard/sources-breakdown-card", () => ({ SourcesBreakdownCard: () => <div data-testid="sources-breakdown" /> }))

import { getBrandBySlug } from "@/lib/services/brands"
import { getUserBrands } from "@/lib/services/brand-owners"
import AnalyticsPage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUserBrands).mockResolvedValue([{ brandId: "b1", brandName: "Test", brandSlug: "test", heroImageUrl: null, claimedAt: "2026-01-01" }])
  vi.mocked(getBrandBySlug).mockResolvedValue({ id: "b1", name: "Test", slug: "test", status: "approved" } as unknown as Brand)
})

describe("AnalyticsPage", () => {
  it("renders all analytics sub-components", async () => {
    render(await AnalyticsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ brand: "test" }) }))
    expect(screen.getByTestId("analytics-cards")).toBeInTheDocument()
    expect(screen.getByTestId("analytics-chart")).toBeInTheDocument()
    expect(screen.getByTestId("link-breakdown")).toBeInTheDocument()
    expect(screen.getByTestId("sources-breakdown")).toBeInTheDocument()
  })
})
