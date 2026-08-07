import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  EXPO_FLOOR_MAP_ASSET,
  EXPO_FLOOR_MAP_GEOMETRY,
  EXPO_ZONE_CODES,
  EXPO_ZONE_DEFINITIONS,
  resolveExpoBoothZone,
  resolveExpoZoneVisualState,
} from "./taiwan-creative-expo-floor-map-config";

describe("the Creative Expo floor-map reference data", () => {
  it("keeps every interactive zone inside the published image view box", () => {
    const { width, height } = EXPO_FLOOR_MAP_GEOMETRY;

    expect(EXPO_ZONE_CODES).toEqual(["K1", "K2", "K3", "S"]);
    for (const definition of EXPO_ZONE_DEFINITIONS) {
      for (const [x, y] of definition.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(height);
      }

      expect(definition.focus.x).toBeGreaterThanOrEqual(0);
      expect(definition.focus.y).toBeGreaterThanOrEqual(0);
      expect(definition.focus.x + definition.focus.width).toBeLessThanOrEqual(
        width,
      );
      expect(definition.focus.y + definition.focus.height).toBeLessThanOrEqual(
        height,
      );
      expect(definition.names.zhTW.length).toBeGreaterThan(0);
      expect(definition.names.en.length).toBeGreaterThan(0);
    }
  });

  it("routes official booth prefixes while leaving non-core areas unfiltered", () => {
    expect(resolveExpoBoothZone("K1-001")).toBe("K1");
    expect(resolveExpoBoothZone("k2 040")).toBe("K2");
    expect(resolveExpoBoothZone("K3-059")).toBe("K3");
    expect(resolveExpoBoothZone("S-021")).toBe("S");
    expect(resolveExpoBoothZone("J1-001")).toBeNull();
    expect(resolveExpoBoothZone("K4-001")).toBeNull();
    expect(resolveExpoBoothZone("")).toBeNull();
  });

  it("gives selected state deterministic precedence over highlighted state", () => {
    expect(
      resolveExpoZoneVisualState({
        zone: "K2",
        selectedZone: "K2",
        highlightedZones: ["K2", "K3"],
      }),
    ).toBe("selected");
    expect(
      resolveExpoZoneVisualState({
        zone: "K3",
        selectedZone: "K2",
        highlightedZones: ["K3"],
      }),
    ).toBe("secondary");
    expect(
      resolveExpoZoneVisualState({
        zone: "K3",
        selectedZone: null,
        highlightedZones: ["K3"],
      }),
    ).toBe("highlighted");
    expect(
      resolveExpoZoneVisualState({
        zone: "S",
        selectedZone: null,
      }),
    ).toBe("default");
  });

  it("ships the inspected lossless derivative at the configured dimensions", async () => {
    const assetPath = resolve(
      process.cwd(),
      "public",
      EXPO_FLOOR_MAP_ASSET.src.slice(1),
    );
    const metadata = await sharp(assetPath).metadata();
    const bytes = statSync(assetPath).size;

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(EXPO_FLOOR_MAP_GEOMETRY.width);
    expect(metadata.height).toBe(EXPO_FLOOR_MAP_GEOMETRY.height);
    expect(bytes).toBeLessThanOrEqual(EXPO_FLOOR_MAP_ASSET.sizeBudgetBytes);
    expect(readFileSync(assetPath).subarray(0, 4).toString("hex")).toBe(
      "52494646",
    );
    expect(
      EXPO_FLOOR_MAP_GEOMETRY.width / EXPO_FLOOR_MAP_GEOMETRY.height,
    ).toBeCloseTo(metadata.width! / metadata.height!);
  });
});
