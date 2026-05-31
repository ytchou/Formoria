// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrandCard } from "./BrandCard";
import type { Brand } from "@/lib/types";

// Mock next/link to a simple anchor element
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

// Mock next/image to a standard img element
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
    onError,
  }: {
    src: string;
    alt: string;
    className?: string;
    onError?: () => void;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onError={onError} />
  ),
}));

const baseBrand: Brand = {
  id: "brand-1",
  name: "Test Brand",
  slug: "test-brand",
  description: "A high-quality Taiwanese brand making sustainable products.",
  logoUrl: "https://example.com/logo.png",
  heroImageUrl: null,
  status: "approved",
  isVerified: false,
  isDemo: false,
  category: "Food",
  foundingYear: 2020,
  purchaseLinks: [],
  socialLinks: {},
  retailLocations: [],
  productPhotos: [],
  contactEmail: null,
  brandHighlights: null,
  tags: [],
  submittedAt: "2026-01-01T00:00:00Z",
  approvedAt: "2026-01-02T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("BrandCard", () => {
  describe("full data rendering", () => {
    it("renders the brand name", () => {
      render(<BrandCard brand={baseBrand} />);
      expect(screen.getByText("Test Brand")).toBeInTheDocument();
    });

    it("renders the brand logo image", () => {
      render(<BrandCard brand={baseBrand} />);
      const img = screen.getByRole("img", { name: "Test Brand logo" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://example.com/logo.png");
    });

    it("renders the primary category tag", () => {
      render(<BrandCard brand={baseBrand} />);
      expect(screen.getByText("Food")).toBeInTheDocument();
    });

    it("renders the description", () => {
      render(<BrandCard brand={baseBrand} />);
      expect(
        screen.getByText(
          "A high-quality Taiwanese brand making sustainable products.",
        ),
      ).toBeInTheDocument();
    });

    it("links to the brand detail page", () => {
      render(<BrandCard brand={baseBrand} />);
      const link = screen.getByRole("link", { name: "View Test Brand" });
      expect(link).toHaveAttribute("href", "/test-brand");
    });
  });

  describe("fallback when no logo", () => {
    it("renders initials fallback instead of image", () => {
      const brandWithoutLogo: Brand = { ...baseBrand, logoUrl: null };
      render(<BrandCard brand={brandWithoutLogo} />);

      // No img element for the logo
      expect(
        screen.queryByRole("img", { name: "Test Brand logo" }),
      ).not.toBeInTheDocument();

      // Initials fallback: "TB" from "Test Brand"
      expect(screen.getByText("TB")).toBeInTheDocument();
    });
  });

  describe("description truncation via CSS", () => {
    it("renders description with line-clamp-2 class", () => {
      const { container } = render(<BrandCard brand={baseBrand} />);
      const desc = container.querySelector(".line-clamp-2");
      expect(desc).toBeInTheDocument();
      expect(desc?.textContent).toBe(
        "A high-quality Taiwanese brand making sustainable products.",
      );
    });
  });

  describe("image error fallback", () => {
    it("shows fallback gradient when image fails to load", () => {
      render(<BrandCard brand={baseBrand} />);
      const img = screen.getByRole("img", { name: "Test Brand logo" });
      fireEvent.error(img);
      expect(screen.getByTestId("image-fallback")).toBeInTheDocument();
    });
  });

  describe("optional fields absent", () => {
    it("does not render category when absent", () => {
      const brandNoCategory: Brand = { ...baseBrand, category: null };
      const { container } = render(<BrandCard brand={brandNoCategory} />);
      const categoryBadge = container.querySelector(".rounded-full");
      expect(categoryBadge).not.toBeInTheDocument();
    });

    it("does not render description paragraph when absent", () => {
      const brandNoDesc: Brand = { ...baseBrand, description: null };
      const { container } = render(<BrandCard brand={brandNoDesc} />);
      const desc = container.querySelector(".line-clamp-2");
      expect(desc).not.toBeInTheDocument();
    });
  });
});
