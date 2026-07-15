type LocalizationOptions = {
  brandName?: string;
};

type VocabularyRule = readonly [
  pattern: RegExp,
  replacement: string,
  label: string,
];

const ZH_CN_TO_TW: readonly VocabularyRule[] = [
  [/人工智能/gu, "人工智慧", "人工智能→人工智慧"],
  [/數據庫/gu, "資料庫", "數據庫→資料庫"],
  [/短視頻/gu, "短影音", "短視頻→短影音"],
  [/互聯網/gu, "網際網路", "互聯網→網際網路"],
  [/用戶端/gu, "使用者端", "用戶端→使用者端"],
  [/直播帶貨/gu, "直播銷售", "直播帶貨→直播銷售"],
  [/視頻/gu, "影片", "視頻→影片"],
  [/質量/gu, "品質", "質量→品質"],
  [/信息/gu, "資訊", "信息→資訊"],
  [/網絡/gu, "網路", "網絡→網路"],
  [/軟件/gu, "軟體", "軟件→軟體"],
  [/硬件/gu, "硬體", "硬件→硬體"],
  [/服務器/gu, "伺服器", "服務器→伺服器"],
  [/屏幕/gu, "螢幕", "屏幕→螢幕"],
  [/鼠標/gu, "滑鼠", "鼠標→滑鼠"],
  [/打印/gu, "列印", "打印→列印"],
  [/用戶/gu, "使用者", "用戶→使用者"],
  [/智能/gu, "智慧", "智能→智慧"],
  [/移動端/gu, "行動裝置", "移動端→行動裝置"],
  [/博主/gu, "創作者", "博主→創作者"],
  [/UP主/gu, "創作者", "UP主→創作者"],
  [/粉絲量/gu, "粉絲數", "粉絲量→粉絲數"],
  [/漲粉/gu, "粉絲成長", "漲粉→粉絲成長"],
  [/水平/gu, "水準", "水平→水準"],
  [/立馬/gu, "馬上", "立馬→馬上"],
  [/給力/gu, "有力", "給力→有力"],
  [/靠譜/gu, "可靠", "靠譜→可靠"],
  [/貓膩/gu, "蹊蹺", "貓膩→蹊蹺"],
  [/性價比/gu, "CP 值", "性價比→CP 值"],
  [/顏值/gu, "外型", "顏值→外型"],
  [/默認/gu, "預設", "默認→預設"],
  [/支持/gu, "支援", "支持→支援"],
  [/兼容/gu, "相容", "兼容→相容"],
  [/卸載/gu, "移除", "卸載→移除"],
  [/反饋/gu, "回饋", "反饋→回饋"],
  [/鏈接/gu, "連結", "鏈接→連結"],
  [/程序/gu, "程式", "程序→程式"],
  [/在線/gu, "線上", "在線→線上"],
  [/點擊/gu, "點選", "點擊→點選"],
  [/內存/gu, "記憶體", "內存→記憶體"],
  [/博客/gu, "部落格", "博客→部落格"],
  [/顆粒度/gu, "細緻度", "顆粒度→細緻度"],
  [/小夥伴/gu, "夥伴", "小夥伴→夥伴"],
  [/落地/gu, "執行", "落地→執行"],
  [/打法/gu, "做法", "打法→做法"],
  [/抓手/gu, "切入點", "抓手→切入點"],
  [/通過/gu, "透過", "通過→透過"],
  [/接地氣/gu, "生活化", "接地氣→生活化"],
] as const;

const PROTECTED_SPAN_PATTERN = /\u0000TW_PROTECTED_(\d+)\u0000/gu;
const URL_PATTERN = /https?:\/\/\S+/gu;
const QUOTED_SPAN_PATTERN = /「[^」]*」/gu;
const CJK_CHARACTER = "[一-鿿]";

function protectSpans(
  text: string,
  brandName?: string,
): { text: string; spans: string[] } {
  const spans: string[] = [];

  const protect = (value: string): string => {
    const index = spans.push(value) - 1;
    return `\u0000TW_PROTECTED_${index}\u0000`;
  };

  let protectedText = text.replace(QUOTED_SPAN_PATTERN, protect);
  protectedText = protectedText.replace(URL_PATTERN, protect);

  if (brandName) {
    protectedText = protectedText.split(brandName).join(protect(brandName));
  }

  return { text: protectedText, spans };
}

function applyVocabulary(text: string, substitutions: string[]): string {
  let localized = text;

  for (const [pattern, replacement, label] of ZH_CN_TO_TW) {
    let matched = false;
    pattern.lastIndex = 0;
    localized = localized.replace(pattern, () => {
      matched = true;
      return replacement;
    });

    if (matched) substitutions.push(label);
  }

  return localized;
}

function stripMarkdown(text: string, substitutions: string[]): string {
  let stripped = text;
  let changed = false;

  stripped = stripped.replace(
    /(\*\*|__)([\s\S]*?)\1/gu,
    (_match, _marker, content: string) => {
      changed = true;
      return content;
    },
  );
  if (changed) substitutions.push("markdown:bold");

  let headingChanged = false;
  stripped = stripped.replace(/^#{1,6}[ \t]+/gmu, () => {
    headingChanged = true;
    return "";
  });
  if (headingChanged) substitutions.push("markdown:heading");

  let listChanged = false;
  stripped = stripped.replace(/^[-*][ \t]+/gmu, () => {
    listChanged = true;
    return "";
  });
  if (listChanged) substitutions.push("markdown:list");

  return stripped;
}

function stripEmoji(text: string, substitutions: string[]): string {
  let changed = false;
  const stripped = text.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu,
    () => {
      changed = true;
      return "";
    },
  );

  if (changed) substitutions.push("emoji:removed");
  return stripped;
}

function normalizePunctuation(text: string, substitutions: string[]): string {
  let normalized = text;
  let changed = false;

  const replaceAdjacentToCjk = (pattern: RegExp, replacement: string): void => {
    const next = normalized.replace(pattern, replacement);
    if (next !== normalized) changed = true;
    normalized = next;
  };

  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER}),|,(?=${CJK_CHARACTER})`, "gu"),
    "，",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER}):|:(?=${CJK_CHARACTER})`, "gu"),
    "：",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER});|;(?=${CJK_CHARACTER})`, "gu"),
    "；",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})!|!(?=${CJK_CHARACTER})`, "gu"),
    "！",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\?|\\?(?=${CJK_CHARACTER})`, "gu"),
    "？",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\(|\\((?=${CJK_CHARACTER})`, "gu"),
    "（",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\)|\\)(?=${CJK_CHARACTER})`, "gu"),
    "）",
  );
  replaceAdjacentToCjk(
    new RegExp(
      `(?<=${CJK_CHARACTER})\\.\\.\\.|\\.\\.\\.(?=${CJK_CHARACTER})`,
      "gu",
    ),
    "⋯⋯",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\.|\\.(?=${CJK_CHARACTER})`, "gu"),
    "。",
  );

  if (changed) substitutions.push("punctuation:normalized");
  return normalized;
}

function restoreSpans(text: string, spans: string[]): string {
  return text.replace(
    PROTECTED_SPAN_PATTERN,
    (_match, index: string) => spans[Number(index)] ?? "",
  );
}

export function localizeToTW(
  text: string,
  options: LocalizationOptions = {},
): { text: string; substitutions: string[] } {
  const substitutions: string[] = [];
  const protectedText = protectSpans(text, options.brandName);
  let localized = applyVocabulary(protectedText.text, substitutions);

  localized = stripMarkdown(localized, substitutions);
  localized = stripEmoji(localized, substitutions);
  localized = normalizePunctuation(localized, substitutions);

  return { text: restoreSpans(localized, protectedText.spans), substitutions };
}

export function stripAiToolArtifacts(text: string): string {
  const cleanedUrls = text.replace(URL_PATTERN, (url) => {
    const hashIndex = url.indexOf("#");
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
    const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const queryIndex = withoutHash.indexOf("?");
    if (queryIndex < 0) return url;

    const base = withoutHash.slice(0, queryIndex);
    const query = withoutHash.slice(queryIndex + 1);
    const keptParams = query.split("&").filter((param) => {
      const normalized = param.toLowerCase();
      return ![
        "utm_source=chatgpt.com",
        "utm_source=openai",
        "utm_source=copilot.com",
        "referrer=grok.com",
      ].includes(normalized);
    });

    return keptParams.length > 0
      ? `${base}?${keptParams.join("&")}${hash}`
      : `${base}${hash}`;
  });

  return cleanedUrls
    .replace(/turn\d+search\d+/gu, "")
    .replace(/citeturn\d+\w*/gu, "");
}
