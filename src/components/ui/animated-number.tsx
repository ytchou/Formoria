'use client'

import { useEffect, useRef } from 'react'
import { useInView } from '@/hooks/use-in-view'

interface AnimatedNumberProps {
  value: number
  duration?: number
  className?: string
}

export function AnimatedNumber({
  value,
  duration = 800,
  className,
}: AnimatedNumberProps) {
  const { ref, inView } = useInView<HTMLSpanElement>()
  const displayRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = displayRef.current
    if (!inView || !el) return

    const prefersReduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      el.textContent = String(value)
      return
    }

    let start: number | null = null
    let raf: number

    function step(timestamp: number) {
      if (start === null) start = timestamp
      const progress = Math.min((timestamp - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      el!.textContent = String(Math.round(eased * value))
      if (progress < 1) {
        raf = requestAnimationFrame(step)
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, duration])

  return (
    <span ref={ref} className={className}>
      <span ref={displayRef}>{value}</span>
    </span>
  )
}
