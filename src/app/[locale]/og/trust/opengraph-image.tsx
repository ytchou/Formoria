import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand/colors";
import { OgLayout } from "@/lib/brand/og-layout";
import { getOgFonts, getOgMarkDataUri } from "@/lib/brand/og-fonts";
import en from "../../../../../messages/en.json";
import zhTW from "../../../../../messages/zh-TW.json";

export const alt = "Formoria";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // This card is the TRUST card — the route is `/og/trust`. It reads
  // `landing.trustSeam.line` — the listings-vs-selections commitment — not
  // Those were the same string only while the trust seam had replaced the
  // manifesto band on the homepage; the band came back on 2026-08-17 and
  // `manifesto.headline`, which reverted to the positioning line when the
  // band came back. A positioning line is not a trust commitment.
  const fallbackTagline =
    locale === "en"
      ? en.landing.trustSeam.line
      : zhTW.landing.trustSeam.line;
  const [fonts, markDataUri] = await Promise.all([
    getOgFonts(),
    getOgMarkDataUri(),
  ]);

  try {
    const t = await getTranslations({ locale, namespace: "landing.trustSeam" });

    return new ImageResponse(
      <OgLayout
        backgroundColor={brand.bg}
        leftStripe={
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: brand.cta,
            }}
          />
        }
        header={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: brand.fg,
              fontFamily: "Bricolage Grotesque",
            }}
          >
            <img alt="" width={36} height={36} src={markDataUri} />
            <div
              style={{
                marginLeft: 14,
                fontSize: 30,
                fontWeight: 700,
                color: brand.fg,
                fontFamily: "Bricolage Grotesque",
              }}
            >
              Formoria
            </div>
          </div>
        }
        headerStyle={{
          display: "flex",
          alignItems: "center",
          color: brand.fg,
          fontFamily: "Bricolage Grotesque",
          position: "absolute",
          top: 72,
          left: 96,
        }}
        contentStyle={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          padding: "120px 96px 96px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 700,
            color: brand.fg,
            lineHeight: 1.22,
            marginBottom: 28,
            fontFamily:
              locale === "en" ? "Bricolage Grotesque" : "Noto Sans TC",
          }}
        >
          {t("line")}
        </div>
      </OgLayout>,
      {
        width: 1200,
        height: 630,
        fonts,
      },
    );
  } catch {
    return new ImageResponse(
      <OgLayout
        backgroundColor={brand.bg}
        leftStripe={
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: brand.cta,
            }}
          />
        }
        header={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: brand.fg,
              fontFamily: "Bricolage Grotesque",
            }}
          >
            <img alt="" width={36} height={36} src={markDataUri} />
            <div
              style={{
                marginLeft: 14,
                fontSize: 30,
                fontWeight: 700,
                color: brand.fg,
                fontFamily: "Bricolage Grotesque",
              }}
            >
              Formoria
            </div>
          </div>
        }
        headerStyle={{
          display: "flex",
          alignItems: "center",
          color: brand.fg,
          fontFamily: "Bricolage Grotesque",
          position: "absolute",
          top: 72,
          left: 96,
        }}
        contentStyle={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          padding: "120px 96px 96px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 700,
            color: brand.fg,
            lineHeight: 1.22,
            marginBottom: 28,
            fontFamily:
              locale === "en" ? "Bricolage Grotesque" : "Noto Sans TC",
          }}
        >
          {fallbackTagline}
        </div>
      </OgLayout>,
      {
        width: 1200,
        height: 630,
        fonts,
      },
    );
  }
}
