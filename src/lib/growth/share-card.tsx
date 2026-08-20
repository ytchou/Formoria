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
 *
 * Inline styles are not drift here — satori resolves nothing else. What v2
 * changes is the palette and the rhythm: warm paper ground, the ink ramp for
 * hierarchy, a 96px accent rule, and 48 / 32 / 24 spacing at card scale.
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
        backgroundColor: brandColors.ground,
        padding: '80px',
      }}
    >
      {/* Logo row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '48px',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" width={44} height={44} src={markDataUri} />
        <div
          style={{
            marginLeft: 16,
            fontSize: 32,
            fontWeight: 700,
            color: brandColors.ink,
            fontFamily: 'Bricolage Grotesque',
          }}
        >
          Formoria
        </div>
      </div>

      {/* Accent rule */}
      <div
        style={{
          display: 'flex',
          width: 96,
          height: 4,
          backgroundColor: brandColors.accent,
          marginBottom: '48px',
        }}
      />

      {/* Headline */}
      <div
        style={{
          display: 'flex',
          fontSize: 52,
          fontWeight: 700,
          // Muted so the ink brand name below stays the dominant element.
          // Colour is the separation: both lines are the same face and weight.
          color: brandColors.inkMuted,
          fontFamily: 'Noto Sans TC',
          // 1.3, not 1.7. Body leading on a 52px headline opened a gap the
          // card could not spare and read as two unrelated lines.
          lineHeight: 1.3,
          marginBottom: '32px',
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
            color: brandColors.ink,
            fontFamily: 'Noto Sans TC',
            lineHeight: 1.15,
            overflow: 'hidden',
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
          color: brandColors.inkMuted,
          fontFamily: 'Bricolage Grotesque',
          marginTop: '32px',
        }}
      >
        formoria.com/brands/{brandData.slug}
      </div>
    </div>
  )
}
