import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'MIT Map — 台灣品牌目錄'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700, marginBottom: 16 }}>
          MIT Map
        </div>
        <div style={{ fontSize: 32, opacity: 0.8 }}>
          台灣品牌目錄
        </div>
      </div>
    ),
    { ...size }
  )
}
