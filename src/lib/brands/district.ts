import { TAIWAN_DISTRICTS } from "@/lib/constants/taiwan-districts";
import type { CitySlug } from "@/lib/constants/taiwan-cities";

function normalizeTaiwanAddress(value: string): string {
  return value
    .trim()
    .replace(/^\d{3,6}/, "")
    .replace(/^(?:\u53f0\u7063|\u81fa\u7063)/, "")
    .replaceAll("\u53f0", "\u81fa");
}

export function matchDistrict(address: string, city: CitySlug): string | null {
  const normalizedAddress = normalizeTaiwanAddress(address);
  const matches = TAIWAN_DISTRICTS[city]
    .filter(({ zh }) => normalizedAddress.includes(normalizeTaiwanAddress(zh)))
    .sort((left, right) => right.zh.length - left.zh.length);

  return matches.at(0)?.zh ?? null;
}
