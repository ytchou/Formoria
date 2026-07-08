// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "test@example.com" } }, error: null }) } }) }))
vi.mock("@/lib/services/brand-owners", () => ({ getUserBrands: vi.fn() }))

import { getUserBrands } from "@/lib/services/brand-owners"
import { redirect } from "next/navigation"
import AnalyticsPage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUserBrands).mockResolvedValue([{ brandId: "b1", brandName: "Test", brandSlug: "test", heroImageUrl: null, claimedAt: "2026-01-01" }])
})

describe("AnalyticsPage", () => {
  it("redirects to the canonical brand analytics route", async () => {
    render(
      await AnalyticsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ brand: "test" }),
      }),
    )

    expect(redirect).toHaveBeenCalledWith("/en/dashboard/brands/test/analytics")
    expect(screen.queryByTestId("analytics-cards")).not.toBeInTheDocument()
  })
})
