import { ImageResponse } from 'next/og'
import { getOgFonts, getOgMarkDataUri } from '@/lib/brand/og-fonts'

export const runtime = 'edge'
export const alt = 'Formoria — trust'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  const [fonts, markDataUri] = await Promise.all([getOgFonts(), getOgMarkDataUri()])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#FAF8F3',
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
            backgroundColor: '#C4693B',
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: 72,
            left: 96,
            display: 'flex',
            alignItems: 'center',
            color: '#1C1C1C',
            fontFamily: 'Bricolage Grotesque',
          }}
        >
          <img alt="" width={36} height={36} src={markDataUri} />
          <div
            style={{
              marginLeft: 14,
              fontSize: 30,
              fontWeight: 700,
              color: '#1C1C1C',
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
              color: '#1C1C1C',
              lineHeight: 1.22,
              marginBottom: 28,
              fontFamily: 'Noto Sans TC',
            }}
          >
            社群精選。品牌認領。實證審核。
          </div>

          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              color: '#1C1C1C',
              lineHeight: 1.25,
              fontFamily: 'Bricolage Grotesque',
            }}
          >
            Community-curated. Owner-claimed. Proof-reviewed.
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
