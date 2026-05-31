import { ImageResponse } from 'next/og'

import { BrandMark } from '@/lib/brand/BrandMark'
import { brand } from '@/lib/brand/colors'
import { getOgFonts } from '@/lib/brand/og-fonts'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  const fonts = await getOgFonts()

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
            left: 96,
            top: 112,
            width: 136,
            height: 6,
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
            padding: '96px',
          }}
        >
          <BrandMark color={brand.primary} size={96} />

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
              島藏
            </div>

            <div
              style={{
                fontSize: 34,
                lineHeight: 1.2,
                color: brand.espresso,
              }}
            >
              台灣製造品牌目錄
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  )
}
