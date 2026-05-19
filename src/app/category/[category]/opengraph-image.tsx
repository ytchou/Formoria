import { ImageResponse } from 'next/og'
import { getTags } from '@/lib/services/taxonomy'
import { getBrands } from '@/lib/services/brands'

export const runtime = 'edge'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category: slug } = await params

  let categoryName = 'Made in Taiwan Brands'
  let brandCount = 0

  try {
    const tags = await getTags('product_type')
    const tag = tags.find((t) => t.slug === slug)

    if (tag) {
      categoryName = tag.nameZh ?? tag.name
      const { totalCount } = await getBrands({
        tags: [slug],
        status: 'approved',
        limit: 0,
      })
      brandCount = totalCount
    }
  } catch {
    // Use fallback values
  }

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
        {/* Left accent bar */}
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

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%',
            height: '100%',
            padding: '60px 80px',
          }}
        >
          {/* Logo */}
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#2C1810',
              letterSpacing: '0.05em',
              marginBottom: 40,
              fontFamily: 'system-ui',
            }}
          >
            MIT Map
          </div>

          {/* Category name */}
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: '#1A1918',
              textAlign: 'center',
              lineHeight: 1.2,
              marginBottom: 24,
              fontFamily: 'system-ui',
            }}
          >
            {categoryName}
          </div>

          {/* Brand count badge */}
          {brandCount > 0 && (
            <div
              style={{
                fontSize: 24,
                color: '#7C7570',
                backgroundColor: '#F5F4F1',
                padding: '8px 24px',
                borderRadius: 999,
                marginBottom: 32,
                fontFamily: 'system-ui',
              }}
            >
              {brandCount} brand{brandCount !== 1 ? 's' : ''}
            </div>
          )}

          {/* Tag line */}
          <div
            style={{
              fontSize: 20,
              color: '#857E79',
              fontFamily: 'system-ui',
            }}
          >
            台灣製造品牌目錄
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
