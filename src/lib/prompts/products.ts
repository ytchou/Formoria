/**
 * Chinese field labels for the products user message, kept here rather than in
 * the phase for the same reason `SITE_IDENTITY_LABELS` is: the phase file is not
 * on the `no-hardcoded-cjk` allowlist, and prompt copy belongs in the prompt
 * module anyway.
 */
export const PRODUCTS_LABELS = {
  userPreamble: "請從以下品牌自有網站資料中挑出最值得收錄的商品：",
  siteUrl: "品牌官方網站：",
  candidatePages: "候選頁面（網址 | 頁面標題與描述）：",
  listingEntryPoints: "品牌商品入口頁（僅供參考，不可作為 official_url）：",
  originExcerpts: "商品產地摘錄（候選網址 | excerpt_id | 原文）：",
} as const;
