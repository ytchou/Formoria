import { describe, expect, it } from "vitest";
import { matchDistrict } from "../district";

describe("matchDistrict", () => {
  it("matches a plain direct-controlled municipality address", () => {
    expect(matchDistrict("臺北市大安區忠孝東路四段1號", "taipei")).toBe(
      "大安區",
    );
  });

  it("matches through a leading postcode", () => {
    expect(matchDistrict("104台北市中山區樂群二路199號2樓", "taipei")).toBe(
      "中山區",
    );
  });

  it("matches the 台 variant against a 臺 vocabulary", () => {
    expect(matchDistrict("台中市西屯區河南路二段500號", "taichung")).toBe(
      "西屯區",
    );
  });

  it("matches a county township", () => {
    expect(matchDistrict("宜蘭縣羅東鎮中正街60號", "yilan")).toBe("羅東鎮");
  });

  it("returns null when the address has no district token", () => {
    expect(matchDistrict("台中市台灣大道三段251號9樓", "taichung")).toBeNull();
  });

  it("returns null for an address with no street at all", () => {
    expect(matchDistrict("台中市", "taichung")).toBeNull();
  });

  it("never matches a district belonging to a different city", () => {
    expect(
      matchDistrict("臺北市大安區忠孝東路四段1號", "kaohsiung"),
    ).toBeNull();
  });

  it("prefers the longest match when two districts are both substrings", () => {
    expect(matchDistrict("高雄市美濃區轉那瑪夏區民權路1號", "kaohsiung")).toBe(
      "那瑪夏區",
    );
  });
});
