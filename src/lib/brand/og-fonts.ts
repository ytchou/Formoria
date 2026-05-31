import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFontFace = {
  name: string;
  data: ArrayBuffer | Buffer;
  style: "normal";
  weight: number;
};

export async function getOgFonts(): Promise<OgFontFace[]> {
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
