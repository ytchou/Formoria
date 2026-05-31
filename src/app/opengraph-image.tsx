import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#FAF7F4',
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
            backgroundColor: '#E06B3F',
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
            padding: '80px 96px',
          }}
        >
          <div
            style={{
              fontSize: 104,
              fontWeight: 700,
              color: '#1A1918',
              lineHeight: 1,
              marginBottom: 28,
              fontFamily: 'system-ui',
            }}
          >
            Formoria
          </div>

          <div
            style={{
              fontSize: 34,
              color: '#E06B3F',
              fontFamily: 'system-ui',
            }}
          >
            Made in Taiwan Brand Directory
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
