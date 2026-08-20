import { ImageResponse } from 'next/og'
import { brand } from '@/lib/brand/colors'
import { OgLayout } from '@/lib/brand/og-layout'
import { getOgFonts, getOgMarkDataUri } from '@/lib/brand/og-fonts'
import { getBrandBySlug } from '@/lib/services/brands'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  const [fonts, markDataUri] = await Promise.all([getOgFonts(), getOgMarkDataUri()])

  try {
    const brandDetail = await getBrandBySlug(slug)
    const brandLabel = locale === 'en' ? 'Taiwanese Brand' : '台灣品牌'
    const categoryName = brandDetail.categoryLabel ?? 'Taiwan brand'

    return new ImageResponse(
      (
        <OgLayout
          backgroundColor={brand.ground}
          leftStripe={
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 8,
                backgroundColor: brand.accent,
              }}
            />
          }
          header={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 48,
                color: brand.ink,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              <img alt="" width={36} height={36} src={markDataUri} />
              <div
                style={{
                  marginLeft: 14,
                  fontSize: 30,
                  fontWeight: 700,
                  color: brand.ink,
                  fontFamily: 'Bricolage Grotesque',
                }}
              >
                Formoria
              </div>
            </div>
          }
          headerStyle={{
            display: 'flex',
            alignItems: 'center',
            color: brand.ink,
            fontFamily: 'Bricolage Grotesque',
          }}
          contentStyle={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            width: '100%',
            height: '100%',
            padding: '96px 96px 96px 104px',
          }}
        >
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              color: brand.ink,
              textAlign: 'left',
              lineHeight: 1.1,
              marginBottom: 24,
              fontFamily: 'Noto Sans TC',
            }}
          >
            {brandDetail.name}
          </div>

          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: brand.inkMuted,
              marginBottom: 32,
              fontFamily: 'Noto Sans TC',
            }}
          >
            {categoryName}
          </div>

          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: brand.accent,
              fontFamily: 'Bricolage Grotesque',
            }}
          >
            {brandLabel}
          </div>
        </OgLayout>
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
        <OgLayout
          backgroundColor={brand.ground}
          leftStripe={
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 8,
                backgroundColor: brand.accent,
              }}
            />
          }
          header={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 48,
                color: brand.ink,
                fontFamily: 'Bricolage Grotesque',
              }}
            >
              <img alt="" width={36} height={36} src={markDataUri} />
              <div
                style={{
                  marginLeft: 14,
                  fontSize: 30,
                  fontWeight: 700,
                  color: brand.ink,
                  fontFamily: 'Bricolage Grotesque',
                }}
              >
                Formoria
              </div>
            </div>
          }
          headerStyle={{
            display: 'flex',
            alignItems: 'center',
            color: brand.ink,
            fontFamily: 'Bricolage Grotesque',
          }}
          contentStyle={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            width: '100%',
            height: '100%',
            padding: '96px 96px 96px 104px',
          }}
        >
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              color: brand.ink,
              textAlign: 'left',
              lineHeight: 1.1,
              marginBottom: 24,
              fontFamily: 'Noto Sans TC',
            }}
          >
            Formoria
          </div>

          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: brand.inkMuted,
              marginBottom: 32,
              fontFamily: 'Noto Sans TC',
            }}
          >
            {locale === 'en' ? 'Taiwanese Brands' : '台灣品牌'}
          </div>

          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: brand.accent,
              fontFamily: 'Bricolage Grotesque',
            }}
          >
            {locale === 'en' ? 'Taiwanese Brand' : '台灣品牌'}
          </div>
        </OgLayout>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
      },
    )
  }
}
