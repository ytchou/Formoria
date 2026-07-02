import { brand as brandColors } from '@/lib/brand/colors'
import { scaleCardNameFontSize } from '@/lib/growth/share-assets'
import type { ReactElement } from 'react'

interface ShareCardBrand {
  name: string
  slug: string
}

/**
 * Returns the satori JSX tree for a 1080×1350 share card.
 * The caller is responsible for loading markDataUri (via getOgMarkDataUri)
 * and passing fonts to ImageResponse.
 */
export function renderShareCard(
  brandData: ShareCardBrand,
  markDataUri: string,
): ReactElement {
  const nameFontSize = scaleCardNameFontSize(brandData.name)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: brandColors.bg,
        padding: '80px',
      }}
    >
      {/* Logo row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '56px',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" width={44} height={44} src={markDataUri} />
        <div
          style={{
            marginLeft: 16,
            fontSize: 32,
            fontWeight: 700,
            color: brandColors.primary,
            fontFamily: 'Bricolage Grotesque',
          }}
        >
          Formoria
        </div>
      </div>

      {/* Green accent bar */}
      <div
        style={{
          display: 'flex',
          width: 80,
          height: 6,
          backgroundColor: brandColors.primary,
          marginBottom: '56px',
        }}
      />

      {/* Headline */}
      <div
        style={{
          display: 'flex',
          fontSize: 52,
          fontWeight: 700,
          color: brandColors.primary,
          fontFamily: 'Noto Sans TC',
          lineHeight: 1.7,
          marginBottom: '48px',
        }}
      >
        我們上架了 Formoria
      </div>

      {/* Brand name — flex-grow fills remaining vertical space */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: nameFontSize,
            fontWeight: 700,
            color: brandColors.fg,
            fontFamily: 'Noto Sans TC',
            lineHeight: 1.7,
            overflow: 'hidden',
            WebkitLineClamp: 2,
          }}
        >
          {brandData.name}
        </div>
      </div>

      {/* Footer URL */}
      <div
        style={{
          display: 'flex',
          fontSize: 28,
          fontWeight: 700,
          color: brandColors.primary,
          fontFamily: 'Bricolage Grotesque',
          marginTop: '48px',
        }}
      >
        formoria.com/brands/{brandData.slug}
      </div>
    </div>
  )
}
