/**
 * The brand count shown on the homepage strip. Above 10 the line reads
 * 「已收錄 {count} 多個台灣品牌」, so the count rounds down to the highest
 * multiple of 10 strictly below the total: 291 → 290, 300 → 290, 11 → 10.
 * At 10 and below the exact total is shown, and the caller drops 「多」
 * because `shown === total`.
 */
export function displayBrandCount(totalBrandCount: number): number {
  return totalBrandCount > 10
    ? Math.floor((totalBrandCount - 1) / 10) * 10
    : totalBrandCount;
}
