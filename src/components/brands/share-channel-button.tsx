'use client'

import type { CSSProperties, ReactNode } from 'react'
import { UnstyledButton } from '@/components/ui/unstyled-button'
import { FOCUS_RING } from '@/components/ui/control-surface'
import { cn } from '@/lib/utils'

interface ShareChannelButtonProps {
  /** The channel's glyph. */
  icon: ReactNode
  label: string
  /** Background + glyph colour for the 44px disc. Brand marks only. */
  discClass: string
  /** For channels whose mark is a gradient rather than a flat fill. */
  discStyle?: CSSProperties
  onClick: () => void
}

/**
 * A 44px brand-coloured disc with a text label beneath it.
 *
 * Not a `Button` shape — the disc is the affordance and the button box only
 * carries the hit rectangle — so the geometry is spelled out here ONCE, on top
 * of the shared primitive, rather than as a lint carve-out at the call site.
 */
export function ShareChannelButton({
  icon,
  label,
  discClass,
  discStyle,
  onClick,
}: ShareChannelButtonProps) {
  return (
    <UnstyledButton
      onClick={onClick}
      data-ph-no-autocapture
      // w-15 (60px), not w-16: four 64px buttons exactly fill the 256px
      // content width at a 288px dialog, so the hit rectangles would abut with
      // no gutter. The 44px disc is unchanged.
      //
      // Built on UnstyledButton, not Button: routing it through the Button CVA
      // meant seven overrides (`h-auto`, `px-0`, a radius, `hover:bg-transparent`
      // …) each cancelling a rule the CVA had just applied. When a control
      // needs to undo most of a variant, it was never that variant.
      className={cn(
        'flex w-15 cursor-pointer flex-col items-center gap-1.5 rounded-control py-1',
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden="true"
        style={discStyle}
        className={cn(
          // Tailwind's `hover:` variant is already wrapped in @media (hover: hover).
          'flex size-11 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105',
          discClass,
        )}
      >
        {icon}
      </span>
      <span className="type-micro text-ink-muted">{label}</span>
    </UnstyledButton>
  )
}
