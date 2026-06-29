// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Brand } from "@/lib/types/brand"

vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (key: string) => key), setRequestLocale: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "test@example.com" } }, error: null }) } }) }))
vi.mock("@/lib/services/brands", () => ({ getBrandBySlug: vi.fn() }))
vi.mock("@/lib/services/brand-owners", () => ({ getUserBrands: vi.fn(), isOwnerOf: vi.fn().mockResolvedValue(true) }))
vi.mock("@/components/dashboard/mit-status-card", () => ({ MitStatusCard: () => <div data-testid="mit-status-card" /> }))

import { getBrandBySlug } from "@/lib/services/brands"
import { getUserBrands } from "@/lib/services/brand-owners"
import VerificationPage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUserBrands).mockResolvedValue([{ brandId: "b1", brandName: "Test", brandSlug: "test", heroImageUrl: null, claimedAt: "2026-01-01" }])
  vi.mocked(getBrandBySlug).mockResolvedValue({ id: "b1", name: "Test", slug: "test", status: "approved", mitStatus: "verified" } as unknown as Brand)
})

describe("VerificationPage", () => {
  it("renders the MIT status card", async () => {
    render(await VerificationPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ brand: "test" }) }))

    expect(screen.getByTestId("mit-status-card")).toBeInTheDocument()
  })
})
