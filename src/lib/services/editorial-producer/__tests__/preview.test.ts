import { expect, it } from "vitest";
import type { Browser } from "@playwright/test";
import { previewHtml, renderPreview } from "../preview";
import type { Run } from "../types";

function run(): Run {
  return {
    catalog: [
      {
        id: "lamp",
        nameZh: "楓木桌燈",
        brandName: "河岸木作",
      },
      {
        id: "stool",
        nameZh: "<b>矮凳</b>",
        brandName: "山腳 & 工房",
      },
    ],
    trail: {
      title: "閱讀角落的<script>禮物</script>",
      description: "一份等待人類選擇的提案。",
      slug: "reading-corner-gifts",
      promise: "讓角落更容易開始閱讀。",
      readerSituation: "晚上的燈照不到書頁。",
      exclusions: "不處理裝修。",
      intro: "燈座以楓木製作。[^f1][^f2]\n\n第二段。",
      sections: [
        {
          key: "light",
          title: "先讓光線到位",
          body: "先看光。[^f3]",
          picks: [{ productId: "lamp", note: "楓木燈座", factIds: ["f3"] }],
        },
        {
          key: "seat",
          title: "再找一個位置坐",
          body: "坐得下來。",
          picks: [{ productId: "stool", note: "矮凳收得進桌下", factIds: [] }],
        },
      ],
      closing: "慢慢來。[^f4]",
    },
  } as unknown as Run;
}
it("renders every section and product, escaped and without citation markers", () => {
  const html = previewHtml(run());
  expect(html).toContain(
    "<h1>閱讀角落的&lt;script&gt;禮物&lt;/script&gt;</h1>",
  );
  expect(html).not.toContain("<script>");
  expect(html).toContain("先讓光線到位");
  expect(html).toContain("再找一個位置坐");
  expect(html).toContain("楓木桌燈");
  expect(html).toContain("河岸木作");
  expect(html).toContain("楓木燈座");
  expect(html).toContain("&lt;b&gt;矮凳&lt;/b&gt;");
  expect(html).toContain("山腳 &amp; 工房");
  expect(html).toContain("晚上的燈照不到書頁。");
  expect(html).toContain("不處理裝修。");
  expect(html).toContain("<p>第二段。</p>");
  expect(html).not.toContain("[^");
  expect(html).toContain("Noto Sans CJK TC");
});
it("screenshots the document full-page and always closes the browser", async () => {
  const seen: unknown[] = [];
  let closed = false;
  const launch = async () =>
    ({
      newPage: async () => ({
        setContent: async (html: string) => seen.push(html),
        screenshot: async (options: unknown) => {
          seen.push(options);
          throw new Error("Target crashed");
        },
      }),
      close: async () => {
        closed = true;
      },
    }) as unknown as Browser;
  await expect(renderPreview("<p>draft</p>", { launch })).rejects.toThrow(
    "Target crashed",
  );
  expect(seen).toEqual(["<p>draft</p>", { fullPage: true, type: "png" }]);
  expect(closed).toBe(true);
});
