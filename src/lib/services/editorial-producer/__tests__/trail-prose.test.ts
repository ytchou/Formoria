import { expect, it } from "vitest";
import { checkZhTw, stripMarkers } from "../trail-prose";
import type { TrailDraft } from "../types";

function trail(overrides: Partial<TrailDraft> = {}): TrailDraft {
  return {
    title: "閱讀角落的禮物",
    description: "一份等待人類選擇的提案。",
    slug: "reading-corner-gifts",
    promise: "讓角落更容易開始閱讀。",
    readerSituation: "晚上的燈照不到書頁。",
    exclusions: "不處理裝修。",
    intro:
      "燈座以楓木製作。[^f1] 參考 https://river-woodwork.example/products/maple-desk-lamp",
    sections: [
      {
        key: "light",
        title: "先讓光線到位",
        body: "先看光。",
        picks: [{ productId: "lamp", note: "楓木燈座", factIds: [] }],
      },
    ],
    closing: "慢慢來。",
    ...overrides,
  };
}
it("strips citation markers with their leading space", () => {
  expect(stripMarkers("燈座以楓木製作 [^f1][^f2]。")).toBe("燈座以楓木製作。");
});
it("passes Taiwan-Mandarin prose and ignores URLs when counting letters", () => {
  const check = checkZhTw(trail());
  expect(check.pass).toBe(true);
  expect(check.hanShare).toBe(1);
  expect(check.bannedTerms).toEqual([]);
});
it("flags prose that is mostly Latin script", () => {
  const check = checkZhTw(
    trail({
      intro: "This reading corner guide explains the lamp choices in English.",
      closing: "Take your time and choose the light that suits the room.",
    }),
  );
  expect(check.pass).toBe(false);
  expect(check.hanShare).toBeLessThan(0.7);
});
it("reports mainland vocabulary without rewriting the draft", () => {
  const draft = trail({ closing: "附上一段視頻。" });
  const check = checkZhTw(draft);
  expect(check.pass).toBe(false);
  expect(check.bannedTerms).toEqual([{ term: "視頻", replacement: "影片" }]);
  expect(draft.closing).toBe("附上一段視頻。");
});
