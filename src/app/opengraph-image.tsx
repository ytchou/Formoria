import { ImageResponse } from 'next/og'

import { brand } from '@/lib/brand/colors'
import { OgLayout } from '@/lib/brand/og-layout'
import { getOgFonts, getOgMarkDataUri } from '@/lib/brand/og-fonts'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  const [fonts, markDataUri] = await Promise.all([getOgFonts(), getOgMarkDataUri()])

  return new ImageResponse(
    (
      <OgLayout
        backgroundColor={brand.bg}
        leftStripe={
          <div
            style={{
              position: 'absolute',
              left: 96,
              top: 112,
              width: 136,
              height: 6,
              backgroundColor: brand.cta,
            }}
          />
        }
        contentStyle={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          width: '100%',
          height: '100%',
          padding: '96px',
        }}
      >
        <img width={96} height={96} src={markDataUri} alt="Formoria mark" />

        <div
          style={{
            fontSize: 118,
            fontWeight: 700,
            color: brand.fg,
            lineHeight: 0.95,
            marginTop: 44,
            fontFamily: 'Bricolage Grotesque',
          }}
        >
          Formoria
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 28,
            gap: 12,
            color: brand.fg,
            fontFamily: 'Noto Sans TC',
            fontWeight: 700,
          }}
        >
          <div
            style={{
              fontSize: 56,
              lineHeight: 1.1,
            }}
          >
            Formoria
          </div>

          <div
            style={{
              fontSize: 34,
              lineHeight: 1.2,
              color: brand.espresso,
            }}
          >
            台灣品牌目錄
          </div>
        </div>
      </OgLayout>
    ),
    {
      ...size,
      fonts,
    },
  )
}
