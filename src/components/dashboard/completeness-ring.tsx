'use client'

import { useEffect, useRef } from 'react'

export function CompletenessRing({ score }: { score: number }) {
  const normalizedScore = Math.min(100, Math.max(0, score))
  const circleRef = useRef<SVGCircleElement>(null)

  useEffect(() => {
    const el = circleRef.current
    if (!el) return

    const prefersReduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      el.style.strokeDashoffset = String(100 - normalizedScore)
      return
    }

    el.style.strokeDashoffset = '100'
    requestAnimationFrame(() => {
      el.style.transition = 'stroke-dashoffset 600ms var(--ease-settle)'
      el.style.strokeDashoffset = String(100 - normalizedScore)
    })
  }, [normalizedScore])

  return (
    <span
      aria-label={`${normalizedScore}%`}
      className="relative flex size-12 shrink-0 items-center justify-center"
      role="img"
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <circle
          className="stroke-muted"
          cx="24"
          cy="24"
          fill="none"
          r="20"
          strokeWidth="4"
        />
        <circle
          ref={circleRef}
          className="stroke-primary"
          cx="24"
          cy="24"
          fill="none"
          pathLength="100"
          r="20"
          strokeDasharray="100"
          strokeDashoffset={100}
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
      <span className="type-label tabular-nums">
        {normalizedScore}%
      </span>
    </span>
  )
}
