import { describe, expect, it } from "vitest";
import { localizeToTW } from "./taiwan-localization";

const VOCABULARY_CASES = [
  ["人工智能", "人工智慧"],
  ["數據庫", "資料庫"],
  ["短視頻", "短影音"],
  ["互聯網", "網際網路"],
  ["用戶端", "使用者端"],
  ["直播帶貨", "直播銷售"],
  ["視頻", "影片"],
  ["質量", "品質"],
  ["信息", "資訊"],
  ["網絡", "網路"],
  ["軟件", "軟體"],
  ["硬件", "硬體"],
  ["服務器", "伺服器"],
  ["屏幕", "螢幕"],
  ["鼠標", "滑鼠"],
  ["打印", "列印"],
  ["用戶", "使用者"],
  ["智能", "智慧"],
  ["移動端", "行動裝置"],
  ["博主", "創作者"],
  ["UP主", "創作者"],
  ["粉絲量", "粉絲數"],
  ["漲粉", "粉絲成長"],
  ["水平", "水準"],
  ["立馬", "馬上"],
  ["給力", "有力"],
  ["靠譜", "可靠"],
  ["貓膩", "蹊蹺"],
  ["性價比", "CP 值"],
  ["顏值", "外型"],
  ["默認", "預設"],
  ["支持", "支援"],
  ["兼容", "相容"],
  ["卸載", "移除"],
  ["反饋", "回饋"],
  ["鏈接", "連結"],
  ["程序", "程式"],
  ["在線", "線上"],
  ["點擊", "點選"],
  ["內存", "記憶體"],
  ["博客", "部落格"],
  ["顆粒度", "細緻度"],
  ["小夥伴", "夥伴"],
  ["落地", "執行"],
  ["打法", "做法"],
  ["抓手", "切入點"],
  ["通過", "透過"],
  ["接地氣", "生活化"],
] as const;

describe("localizeToTW — vocabulary", () => {
  it("covers every approved zh-CN→zh-TW vocabulary pair", () => {
    for (const [source, expected] of VOCABULARY_CASES) {
      expect(localizeToTW(source).text).toBe(expected);
    }
  });

  it("substitutes zero-tolerance zh-CN terms", () => {
    const r = localizeToTW("這個視頻的質量很高，信息豐富");
    expect(r.text).toBe("這個影片的品質很高，資訊豐富");
    expect(r.substitutions).toContain("視頻→影片");
    expect(r.substitutions).toContain("質量→品質");
    expect(r.substitutions).toContain("信息→資訊");
  });

  it("matches longest pattern first (數據庫 before 數據)", () => {
    const r = localizeToTW("數據庫中的數據");
    expect(r.text).toBe("資料庫中的數據");
  });

  it("matches longest pattern first (人工智能 before 智能)", () => {
    const r = localizeToTW("人工智能與智能手機");
    expect(r.text).toBe("人工智慧與智慧手機");
  });

  it("matches longest pattern first (短視頻 before 視頻)", () => {
    const r = localizeToTW("短視頻平台上的視頻");
    expect(r.text).toBe("短影音平台上的影片");
  });

  it("substitutes reclassified context-dependent terms", () => {
    const r = localizeToTW("小夥伴們的打法很落地");
    expect(r.text).toBe("夥伴們的做法很執行");
  });

  it("preserves brand name when passed via options", () => {
    const r = localizeToTW("信息設計坊提供優質信息服務", {
      brandName: "信息設計坊",
    });
    expect(r.text).toBe("信息設計坊提供優質資訊服務");
  });

  it("preserves text inside「」quotes", () => {
    const r = localizeToTW("他說「這個視頻質量不錯」但我覺得信息不足");
    expect(r.text).toBe("他說「這個視頻質量不錯」但我覺得資訊不足");
  });

  it("preserves URLs unchanged", () => {
    const r = localizeToTW("詳見 https://example.com/视频信息 的說明");
    expect(r.text).toContain("https://example.com/视频信息");
  });

  it("returns empty substitutions for text with no zh-CN terms", () => {
    const r = localizeToTW("台灣品牌以品質著稱");
    expect(r.text).toBe("台灣品牌以品質著稱");
    expect(r.substitutions).toEqual([]);
  });

  it("handles empty string", () => {
    const r = localizeToTW("");
    expect(r.text).toBe("");
    expect(r.substitutions).toEqual([]);
  });
});

describe("localizeToTW — punctuation", () => {
  it("normalizes half-width punctuation between CJK characters", () => {
    const r = localizeToTW("品牌,設計:好;用!");
    expect(r.text).toBe("品牌，設計：好；用！");
  });

  it("preserves half-width punctuation in English context", () => {
    const r = localizeToTW("Hello, world! 你好");
    expect(r.text).toContain("Hello, world!");
  });

  it("normalizes ellipsis to ⋯⋯", () => {
    const r = localizeToTW("品牌創立於2015年...至今已十年");
    expect(r.text).toBe("品牌創立於2015年⋯⋯至今已十年");
  });

  it("normalizes half-width period at CJK sentence end", () => {
    const r = localizeToTW("這是台灣品牌.");
    expect(r.text).toBe("這是台灣品牌。");
  });

  it("normalizes parentheses between CJK characters", () => {
    const r = localizeToTW("台灣(品牌)設計");
    expect(r.text).toBe("台灣（品牌）設計");
  });
});

describe("localizeToTW — markdown stripping", () => {
  it("strips bold markers", () => {
    const r = localizeToTW("這是**品牌特色**的介紹");
    expect(r.text).toBe("這是品牌特色的介紹");
    expect(r.substitutions).toContain("markdown:bold");
  });

  it("strips underscore bold markers", () => {
    const r = localizeToTW("這是__品牌__的故事");
    expect(r.text).toBe("這是品牌的故事");
  });

  it("strips heading prefixes", () => {
    const r = localizeToTW("## 品牌簡介\n以手工皮革聞名");
    expect(r.text).toBe("品牌簡介\n以手工皮革聞名");
  });

  it("strips list markers", () => {
    const r = localizeToTW("- 手工皮革\n- 台灣設計");
    expect(r.text).toBe("手工皮革\n台灣設計");
  });
});

describe("localizeToTW — emoji removal", () => {
  it("strips emoji from text", () => {
    const r = localizeToTW("台灣品牌🎉專注設計✨");
    expect(r.text).toBe("台灣品牌專注設計");
  });

  it("preserves text with no emoji", () => {
    const r = localizeToTW("台灣品牌專注設計");
    expect(r.text).toBe("台灣品牌專注設計");
  });
});
