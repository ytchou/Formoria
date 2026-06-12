import { ImageResponse } from 'next/og'
import { getTranslations } from 'next-intl/server'
import { brand } from '@/lib/brand/colors'
import { getOgFonts, getOgMarkDataUri } from '@/lib/brand/og-fonts'

export const alt = 'Formoria — trust'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const [fonts, markDataUri] = await Promise.all([getOgFonts(), getOgMarkDataUri()])

  try {
    const t = await getTranslations({ locale, namespace: 'about.trust' })

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
              width: 4,
              backgroundColor: brand.cta,
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: 72,
              left: 96,
              display: 'flex',
              alignItems: 'center',
              color: brand.fg,
              fontFamily: 'Bricolage Grotesque',
            }}
          >
            <img alt="" width={36} height={36} src={markDataUri} />
            <div
              style={{
                marginLeft: 14,
                fontSize: 30,
                fontWeight: 700,
                color: brand.fg,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              Formoria
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
              height: '100%',
              padding: '120px 96px 96px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 68,
                fontWeight: 700,
                color: brand.fg,
                lineHeight: 1.22,
                marginBottom: 28,
                fontFamily: locale === 'en' ? 'Bricolage Grotesque' : 'Noto Sans TC',
              }}
            >
              {t('tagline')}
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
              width: 4,
              backgroundColor: brand.cta,
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: 72,
              left: 96,
              display: 'flex',
              alignItems: 'center',
              color: brand.fg,
              fontFamily: 'Bricolage Grotesque',
            }}
          >
            <img alt="" width={36} height={36} src={markDataUri} />
            <div
              style={{
                marginLeft: 14,
                fontSize: 30,
                fontWeight: 700,
                color: brand.fg,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              Formoria
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
              height: '100%',
              padding: '120px 96px 96px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 68,
                fontWeight: 700,
                color: brand.fg,
                lineHeight: 1.22,
                marginBottom: 28,
                fontFamily: locale === 'en' ? 'Bricolage Grotesque' : 'Noto Sans TC',
              }}
            >
              {locale === 'en' ? 'Trust Made Visible' : '看得見的信任'}
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
