// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zhMessages from "../../../../../messages/zh-TW.json";
import { getBrandSlugsBatch } from "@/lib/services/brands";
import { getModerationFlagsBatch } from "@/lib/services/moderation";
import { getSubmissionsForReview } from "@/lib/services/submissions";
import SubmissionsPage, { generateMetadata } from "../page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/submissions",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => {
    const messages = {
      title: "品牌提交",
      description: "人工核准或拒絕前請先完成資料抓取。",
    };

    return messages[key as keyof typeof messages] ?? key;
  }),
}));

vi.mock("@/lib/services/brands", () => ({
  getBrandSlugsBatch: vi.fn(),
}));

vi.mock("@/lib/services/moderation", () => ({
  getModerationFlagsBatch: vi.fn(),
}));

vi.mock("@/lib/services/submissions", () => ({
  getSubmissionsForReview: vi.fn(),
}));

describe("SubmissionsPage", () => {
  beforeEach(() => {
    vi.mocked(getSubmissionsForReview).mockResolvedValue([]);
    vi.mocked(getModerationFlagsBatch).mockResolvedValue(new Map());
    vi.mocked(getBrandSlugsBatch).mockResolvedValue(new Map());
  });

  it("renders the page heading and description in the request locale", async () => {
    const page = await SubmissionsPage({ searchParams: Promise.resolve({}) });

    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        {page}
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "品牌提交" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("人工核准或拒絕前請先完成資料抓取。"),
    ).toBeInTheDocument();
  });

  it("localizes the page metadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "品牌提交" });
  });
});
