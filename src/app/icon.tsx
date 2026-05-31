import { ImageResponse } from 'next/og'

import { BrandMark } from '@/lib/brand/BrandMark'
import { brand } from '@/lib/brand/colors'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: brand.primary,
        }}
      >
        <BrandMark color={brand.bg} size={28} />
      </div>
    ),
    { width: 32, height: 32 },
  )
}
