import { ImageResponse } from "next/og";

import { brand } from "@/lib/brand/colors";
import { OgLayout } from "@/lib/brand/og-layout";
import { getOgFonts, getOgMarkDataUri } from "@/lib/brand/og-fonts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The site card. Warm paper ground, ink wordmark, one accent mark, and the
 * 96 / 32 / 24 rhythm — the v2 spacing tokens at OG scale.
 *
 * v1 printed "Formoria" TWICE on this card, once at 118px in Bricolage and
 * again at 56px in Noto Sans TC, with the tagline third. Two sizes of the same
 * word is not a hierarchy; the wordmark says it once and the tagline answers.
 */
export default async function OgImage() {
  const [fonts, markDataUri] = await Promise.all([
    getOgFonts(),
    getOgMarkDataUri(),
  ]);

  return new ImageResponse(
    <OgLayout
      backgroundColor={brand.ground}
      leftStripe={
        <div
          style={{
            position: "absolute",
            left: 96,
            top: 112,
            width: 96,
            height: 4,
            backgroundColor: brand.accent,
          }}
        />
      }
      contentStyle={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        width: "100%",
        height: "100%",
        padding: "96px",
      }}
    >
      <img width={96} height={96} src={markDataUri} alt="Formoria mark" />

      <div
        style={{
          fontSize: 118,
          fontWeight: 700,
          color: brand.ink,
          lineHeight: 0.95,
          marginTop: 32,
          fontFamily: "Bricolage Grotesque",
        }}
      >
        Formoria
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 38,
          lineHeight: 1.2,
          marginTop: 24,
          color: brand.inkMuted,
          fontFamily: "Noto Sans TC",
          fontWeight: 700,
        }}
      >
        台灣品牌探索與選物平台
      </div>
    </OgLayout>,
    {
      ...size,
      fonts,
    },
  );
}
