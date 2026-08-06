export type ExpoZoneCode = "K1" | "K2" | "K3" | "S";

type ExpoPoint = readonly [x: number, y: number];

type ExpoPolygon = readonly ExpoPoint[];

type ExpoFocusBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ExpoZoneDefinition = Readonly<{
  code: ExpoZoneCode;
  names: Readonly<{
    zhTW: string;
    en: string;
  }>;
  color: string;
  polygon: ExpoPolygon;
  focus: ExpoFocusBounds;
}>;

export type ExpoZoneVisualState =
  "default" | "highlighted" | "secondary" | "selected";

/**
 * The published derivative is a 3200 × 2450 crop of page 2's central map.
 * Keep this geometry next to the source metadata so an asset replacement cannot
 * silently drift away from the SVG coordinate system.
 */
export const EXPO_FLOOR_MAP_GEOMETRY = {
  width: 3200,
  height: 2450,
  viewBox: "0 0 3200 2450",
  aspectRatio: 3200 / 2450,
} as const;

export const EXPO_FLOOR_MAP_ASSET = {
  src: "/images/events/taiwan-creative-expo-2026-floor-map.webp",
  alt: "Taiwan Creative Expo 2026 floor map",
  sourceUrl:
    "https://creativexpo.tw/uploads/download/file/9/2026%E8%87%BA%E7%81%A3%E6%96%87%E5%8D%9A%E6%9C%83%E6%91%BA%E9%A0%81DM(2).pdf",
  retrievedOn: "2026-08-06",
  sourceSha256:
    "ccd1cd250a7b3593c730d5d70e3c137eec684d282ab1c0b0b9579c96952d06bb",
  sizeBudgetBytes: 2_500_000,
} as const;

const EXPO_ZONE_NAMES = {
  K1: {
    zhTW: "\u98a8\u683c\u751f\u6d3b",
    en: "Lifestyle",
  },
  K2: {
    zhTW: "\u5de5\u85dd\u8207\u6587\u5316\u6c38\u7e8c",
    en: "Craftsmanship & Cultural Sustainability",
  },
  K3: {
    zhTW: "\u6587\u5275\u79ae\u54c1",
    en: "Gifts",
  },
  S: {
    zhTW: "\u65b0\u92b3\u54c1\u724c",
    en: "Start-ups",
  },
} as const satisfies Record<
  ExpoZoneCode,
  Readonly<{ zhTW: string; en: string }>
>;

/**
 * Calibrated against the colored headings and booth blocks in the source map.
 * These are deliberately broad regions: booth-level coordinates are not part
 * of DEV-1371 and remain readable beneath the translucent state fills.
 */
export const EXPO_ZONE_DEFINITIONS = [
  {
    code: "K1",
    names: EXPO_ZONE_NAMES.K1,
    color: "var(--color-chart-4)",
    polygon: [
      [1560, 1575],
      [2450, 1575],
      [2450, 2270],
      [1560, 2270],
    ],
    focus: { x: 1530, y: 1525, width: 980, height: 765 },
  },
  {
    code: "K2",
    names: EXPO_ZONE_NAMES.K2,
    color: "var(--color-info)",
    polygon: [
      [1560, 1080],
      [2450, 1080],
      [2450, 1585],
      [1560, 1585],
    ],
    focus: { x: 1530, y: 1035, width: 980, height: 625 },
  },
  {
    code: "K3",
    names: EXPO_ZONE_NAMES.K3,
    color: "var(--color-muted-foreground)",
    polygon: [
      [2470, 1000],
      [3190, 1000],
      [3190, 1905],
      [2470, 1905],
    ],
    focus: { x: 2435, y: 955, width: 765, height: 985 },
  },
  {
    code: "S",
    names: EXPO_ZONE_NAMES.S,
    color: "var(--color-border)",
    polygon: [
      [2470, 105],
      [3190, 105],
      [3190, 1120],
      [2470, 1120],
    ],
    focus: { x: 2435, y: 70, width: 765, height: 1090 },
  },
] as const satisfies readonly ExpoZoneDefinition[];

export const EXPO_ZONE_CODES = EXPO_ZONE_DEFINITIONS.map(
  ({ code }) => code,
) as ExpoZoneCode[];

const BOOTH_PREFIX_PATTERN = /^(K1|K2|K3|S)(?=$|(?:[-\s]?\d{2,3})(?:\b|$))/i;

/** Resolve a canonical booth code to one of the four interactive zones. */
export function resolveExpoBoothZone(
  booth: string | null | undefined,
): ExpoZoneCode | null {
  const normalized = booth?.trim();
  if (!normalized) return null;

  const match = BOOTH_PREFIX_PATTERN.exec(normalized);
  return match ? (match[1].toUpperCase() as ExpoZoneCode) : null;
}

/**
 * Selected state wins over highlight state. Once a zone is selected, all other
 * interactive zones become secondary so the source booth labels remain legible.
 */
export function resolveExpoZoneVisualState({
  zone,
  selectedZone,
  highlightedZones = [],
}: Readonly<{
  zone: ExpoZoneCode;
  selectedZone: ExpoZoneCode | null;
  highlightedZones?: readonly ExpoZoneCode[];
}>): ExpoZoneVisualState {
  if (selectedZone === zone) return "selected";
  if (selectedZone !== null) return "secondary";
  if (highlightedZones.includes(zone)) return "highlighted";
  return "default";
}
