import {
  L2_SUBCATEGORIES,
  L1_CATEGORIES,
  MATERIALS,
} from "@/lib/taxonomy/ontology";

// Object kinds, not techniques — a technique word classifies the same product
// kind into two L1s. Since DEV-1507 retired `crafts` these follow the
// re-file map its migration applied: 金工 → `jewelry`, 編織・鉤織 →
// `stationery` (where `craft-kits-and-supplies` lives), and only the object
// kinds 陶藝・木工・插畫 → `home` (where `wall-art` lives). Keep this in step
// with `SUBCATEGORY_VOCAB_BLOCK` below and with `HINT_KEYWORD_MAP` in
// scripts/threads-scraper/finalize.ts.
const CATEGORY_EXAMPLES: Record<string, string> = {
  fashion: "服飾、鞋履、上衣、褲子、洋裝等穿戴服裝",
  "bags-accessories": "包袋、皮件、帽子、圍巾、配件、皮革工藝",
  jewelry: "飾品、珠寶、耳環、項鍊、戒指、手鍊、金工",
  beauty: "美妝、保養、清潔、沐浴、香氛、蠟燭",
  home: "居家用品、餐具、陶瓷、家具、廚具、園藝、陶藝、木工、插畫",
  "food-drink": "食品、飲料、茶、咖啡、農產品",
  stationery: "文具、筆記本、鋼筆、紙膠帶、手帳、桌面配件、編織、鉤織",
  tech: "3C科技、電子產品、手機配件",
  outdoor: "戶外露營、登山背包、露營裝備、攀岩用品",
  fitness: "健身器材、瑜珈用品、運動服飾、運動配件、重訓裝備",
  kids: "兒童、嬰兒、童裝、玩具、育兒用品",
  pets: "寵物用品、寵物食品、寵物服飾、寵物玩具",
};

export const CATEGORY_LIST = L1_CATEGORIES.map(
  (c) => `- ${c.slug}: ${CATEGORY_EXAMPLES[c.slug] ?? c.nameZh}`,
).join("\n");

const _subcatByCategory = new Map<string, string[]>();
for (const sub of L2_SUBCATEGORIES) {
  const arr = _subcatByCategory.get(sub.category) ?? [];
  // Slug first, zh gloss in parentheses — the `CATEGORY_LIST` shape above, which
  // has emitted L1 slugs this way since before DEV-1510 and demonstrably works.
  // The slug is what gets STORED (`brands.subcategories`), so the model must
  // emit it verbatim; the gloss is only there to make the slug recognisable to
  // a model reasoning over zh-TW source material.
  const aliasSuffix =
    sub.aliases.length > 0 ? `：${sub.aliases.join("、")}` : "";
  arr.push(`${sub.slug}（${sub.nameZh}${aliasSuffix}）`);
  _subcatByCategory.set(sub.category, arr);
}

export const SUBCATEGORY_VOCAB_BLOCK = L1_CATEGORIES.map((c) => {
  const subs = _subcatByCategory.get(c.slug) ?? [];
  return `- ${c.slug}（${c.nameZh}）：${subs.join("、")}`;
}).join("\n");

/**
 * The material axis, closed to the twelve agreed slugs. Interpolated from
 * `MATERIALS` for the same reason `CATEGORY_LIST` is interpolated from
 * `L1_CATEGORIES`: the vocabulary is CLOSED and mirrored by a Postgres CHECK,
 * so a hand-typed copy here would ask the model for values the write path
 * rejects with a 23514.
 *
 * Slug plus zh gloss, because the model reads a zh-TW product page but the
 * value it must RETURN is the English slug — the schema accepts only the slug,
 * and `createCuratedProduct`'s material normalisation resolves slugs only and
 * discards a Chinese label silently.
 */
export const MATERIAL_VOCAB_BLOCK = MATERIALS.map(
  (material) => `- ${material.slug}: ${material.nameZh}`,
).join("\n");

export const TAIWAN_USAGE_RULES = `- Use Taiwanese Traditional Chinese terms: 影片 (not 視頻), 品質 (not 質量), 資訊 (not 信息), 網路 (not 網絡), 軟體 (not 軟件), 螢幕 (not 屏幕), 連結 (not 鏈接), 使用者 (not 用戶), 預設 (not 默認)
- Use full-width punctuation: ，。：；！？「」; use ⋯⋯ for ellipsis; use 、 for parallel items
- Forbidden terms: 「賦能」「閉環」「抓手」and other abstract jargon — replace with concrete descriptions (who can do what, from where to where)
- Avoid empty phrases: 「標誌著」「見證了」「體現了」「彰顯了」「在當今」「隨著⋯⋯發展」「未來充滿可能」「不只是A更是B」
- Avoid unsourced positive claims: 「廣受好評」「獲得多家媒體報導」require a specific source, otherwise delete
- Every sentence must contain a concrete fact unique to this brand — delete and rewrite any sentence that still holds true after removing the brand name
- Descriptions need no closing flourish or future outlook — end on the last concrete fact
- Avoid the "from X to Y" pattern claiming the brand covers all aspects, unless the source explicitly states this
- Vary sentence structure: no more than 3 consecutive sentences with the same pattern; no summary sentence at the end of every paragraph
- Output plain text only, no Markdown syntax (no **bold**, # headings, - lists)`;
