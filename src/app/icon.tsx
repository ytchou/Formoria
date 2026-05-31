import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FAF7F4',
        }}
      >
        <div
          style={{
            color: '#E06B3F',
            fontFamily: 'system-ui',
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          F
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
