// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageToc } from "@/components/ui/page-toc";

const ITEMS = [
  { id: "dataCollection", label: "資料蒐集" },
  { id: "cookies", label: "Cookie" },
  { id: "contact", label: "聯絡我們" },
] as const;

describe("PageToc", () => {
  it.each(["rail", "inline"] as const)(
    "%s: the nav is named by the label and links one per item",
    (variant) => {
      render(<PageToc variant={variant} label="本頁內容" items={ITEMS} />);

      // e2e (static-pages.spec.ts) queries the nav by this exact name.
      const nav = screen.getByRole("navigation", { name: "本頁內容" });
      const links = within(nav).getAllByRole("link");
      expect(links).toHaveLength(ITEMS.length);
      ITEMS.forEach(({ id, label }, i) => {
        expect(links[i]).toHaveAttribute("href", `#${id}`);
        expect(links[i]).toHaveTextContent(label);
      });
    },
  );

  it("shows the label visibly without changing the accessible name", () => {
    render(
      <PageToc variant="inline" label="本頁內容" labelVisible items={ITEMS} />,
    );

    const nav = screen.getByRole("navigation", { name: "本頁內容" });
    expect(within(nav).getByText("本頁內容")).toBeVisible();
    expect(within(nav).getAllByRole("link")).toHaveLength(ITEMS.length);
  });

  it("renders no visible label by default", () => {
    render(<PageToc variant="rail" label="常見問題分類" items={ITEMS} />);

    const nav = screen.getByRole("navigation", { name: "常見問題分類" });
    expect(within(nav).queryByText("常見問題分類")).toBeNull();
  });
});
