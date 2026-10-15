// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  StorySources,
  storySourceLinks,
} from "@/components/stories/story-sources";

describe("storySourceLinks", () => {
  it("drops the protocol and www. from the label", () => {
    expect(
      storySourceLinks([
        "https://www.example.com/report",
        "http://example.org/a?b=1",
      ]),
    ).toEqual([
      {
        href: "https://www.example.com/report",
        label: "example.com/report",
      },
      { href: "http://example.org/a?b=1", label: "example.org/a?b=1" },
    ]);
  });

  it("percent-decodes the label but keeps the encoded href", () => {
    const href =
      "https://www.taiwan.net.tw/%E5%B7%A5%E8%97%9D%E5%B1%95";
    expect(storySourceLinks([href])).toEqual([
      { href, label: "taiwan.net.tw/工藝展" },
    ]);
  });

  it("falls back to the raw text when decoding throws", () => {
    // A lone `%` is a malformed escape: `decodeURI` throws URIError on it.
    expect(storySourceLinks(["https://example.com/100%"])).toEqual([
      { href: "https://example.com/100%", label: "example.com/100%" },
    ]);
  });

  it("drops entries that are not safe http(s) URLs", () => {
    expect(
      storySourceLinks([
        "javascript:alert(1)",
        "mailto:editor@example.com",
        "",
        "   ",
        "not a url",
        "https://example.com/ok",
      ]),
    ).toEqual([{ href: "https://example.com/ok", label: "example.com/ok" }]);
  });
});

describe("StorySources", () => {
  it("renders the sources as a labelled, ordered list of outbound links", () => {
    render(
      <StorySources
        heading="參考資料"
        sources={["https://www.example.com/report", "https://example.org/b"]}
      />,
    );

    const section = screen.getByRole("region", { name: "參考資料" });
    expect(
      within(section).getByRole("heading", { level: 2, name: "參考資料" }),
    ).toBeInTheDocument();
    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("OL");
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://www.example.com/report");
    expect(links[0]).toHaveTextContent("example.com/report");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(
      <StorySources heading="參考資料" sources={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every entry is unsafe", () => {
    const { container } = render(
      <StorySources heading="參考資料" sources={["javascript:alert(1)"]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
