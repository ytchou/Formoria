'use client'

import { useEffect } from 'react'

/**
 * Opens the <details> element whose id matches the current URL hash (e.g.
 * /faq#claim), since native <details> stays collapsed on hash navigation.
 * Runs on mount and on subsequent hash changes.
 */
export function OpenTargetDetails() {
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1)
      if (!id) return
      const el = document.getElementById(id)
      if (el instanceof HTMLDetailsElement) {
        el.open = true
        el.scrollIntoView({ block: 'start' })
      }
    }

    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

  return null
}
