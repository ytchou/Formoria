import { ImageResponse } from 'next/og'
import { brand } from '@/lib/brand/colors'
import { getOgFonts, getOgMarkDataUri } from '@/lib/brand/og-fonts'
import { getActiveCategories } from '@/lib/services/taxonomy'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const [fonts, markDataUri] = await Promise.all([getOgFonts(), getOgMarkDataUri()])

  try {
    const categories = await getActiveCategories()
    const heading = locale === 'en' ? 'Browse by category' : '依分類瀏覽'

    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            backgroundColor: brand.bg,
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 8,
              backgroundColor: brand.cta,
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              width: '100%',
              height: '100%',
              padding: '72px 96px 72px 116px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 72,
                color: brand.primary,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              <img alt="" width={36} height={36} src={markDataUri} />
              <div
                style={{
                  marginLeft: 14,
                  fontSize: 30,
                  fontWeight: 700,
                  color: brand.primary,
                  fontFamily: 'Bricolage Grotesque',
                }}
              >
                Formoria
              </div>
            </div>

            <div
              style={{
                fontSize: 84,
                fontWeight: 700,
                color: brand.fg,
                textAlign: 'left',
                lineHeight: 1.1,
                marginBottom: 28,
                fontFamily: 'Noto Sans TC',
              }}
            >
              {heading}
            </div>

            <div
              style={{
                fontSize: 30,
                fontWeight: 700,
                color: brand.espresso,
                marginBottom: 36,
                fontFamily: 'Noto Sans TC',
              }}
            >
              台灣製造品牌目錄
            </div>

            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: brand.cta,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
      },
    )
  } catch {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            backgroundColor: brand.bg,
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 8,
              backgroundColor: brand.cta,
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'flex-start',
              width: '100%',
              height: '100%',
              padding: '72px 96px 72px 116px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 72,
                color: brand.primary,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              <img alt="" width={36} height={36} src={markDataUri} />
              <div
                style={{
                  marginLeft: 14,
                  fontSize: 30,
                  fontWeight: 700,
                  color: brand.primary,
                  fontFamily: 'Bricolage Grotesque',
                }}
              >
                Formoria
              </div>
            </div>

            <div
              style={{
                fontSize: 84,
                fontWeight: 700,
                color: brand.fg,
                textAlign: 'left',
                lineHeight: 1.1,
                marginBottom: 28,
                fontFamily: 'Noto Sans TC',
              }}
            >
              {locale === 'en' ? 'Browse by category' : '依分類瀏覽'}
            </div>

            <div
              style={{
                fontSize: 30,
                fontWeight: 700,
                color: brand.espresso,
                marginBottom: 36,
                fontFamily: 'Noto Sans TC',
              }}
            >
              台灣製造品牌目錄
            </div>

            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: brand.cta,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              Formoria categories
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
      },
    )
  }
}
