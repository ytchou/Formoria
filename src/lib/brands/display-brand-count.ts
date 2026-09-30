/**
 * The brand count shown on the homepage. Both count lines read "超過 {count}",
 * so the count rounds down to the highest 50 step strictly below the total:
 * 291 → 250, 300 → 250. At 50 and below the exact total is shown.
 */
export function displayBrandCount(totalBrandCount: number): number {
  return totalBrandCount > 50
    ? Math.floor((totalBrandCount - 1) / 50) * 50
    : totalBrandCount;
}
