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
export const CATEGORY_EXAMPLES: Record<string, string> = {
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
  arr.push(`${sub.slug}（${sub.nameZh}）`);
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

export const TAIWAN_USAGE_RULES = `- 使用台灣繁體中文用語：影片（非視頻）、品質（非質量）、資訊（非信息）、網路（非網絡）、軟體（非軟件）、螢幕（非屏幕）、連結（非鏈接）、使用者（非用戶）、預設（非默認）
- 標點符號使用全形：，。：；！？「」；省略號用⋯⋯；並列項目用頓號「、」
- 禁止使用：「賦能」「閉環」「抓手」等抽象用語——改為具體描述（誰能做到什麼、從哪裡到哪裡）
- 避免空洞用語：「標誌著」「見證了」「體現了」「彰顯了」「在當今」「隨著⋯⋯發展」「未來充滿可能」「不只是A更是B」
- 避免無來源的正面評價：「廣受好評」「獲得多家媒體報導」需附具體來源，否則刪除
- 每句話應包含只有該品牌才有的具體事實——任何拔掉品牌名稱後仍然成立的句子請刪掉重寫
- 描述不需要有收尾金句或對未來的展望——結尾可以停在最後一個具體的事實上
- 避免用「從X到Y」語式宣稱品牌涵蓋所有面向，除非來源資料明確說明
- 句式多變，不可連續三句以上相同結構；不可每段以總結句收尾
- 輸出純文字，不可包含 Markdown 語法（禁止 **粗體**、# 標題、- 列表）`;
