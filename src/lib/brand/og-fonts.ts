import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageResponse } from "next/og";

type ImageResponseOptions = NonNullable<
  ConstructorParameters<typeof ImageResponse>[1]
>;

export type OgFontFace = NonNullable<ImageResponseOptions["fonts"]>[number];
type OgFonts = NonNullable<ImageResponseOptions["fonts"]>;

export async function getOgFonts(): Promise<OgFonts> {
  try {
    const [bricolageData, notoSansTcData] = await Promise.all([
      readFile(
        join(process.cwd(), "src/assets/fonts/BricolageGrotesque-Latin.ttf"),
      ),
      readFile(join(process.cwd(), "src/assets/fonts/NotoSansTC-subset.ttf")),
    ]);

    return [
      {
        name: "Bricolage Grotesque",
        data: bricolageData,
        style: "normal",
        weight: 700,
      },
      {
        name: "Noto Sans TC",
        data: notoSansTcData,
        style: "normal",
        weight: 700,
      },
    ];
  } catch (error) {
    console.warn("Failed to load OG fonts; falling back to []", error);
    return [];
  }
}
