'use client'

import { useEffect } from 'react'

/**
 * Opens the <details> element whose id matches the current URL hash (e.g.
 * /faq#claim or /brands/<slug>#faq-taiwan-origin), since native <details>
 * stays collapsed on hash navigation. Runs on mount and on subsequent hash
 * changes.
 *
 * Lives in components/shared rather than beside the /faq route because the
 * brand FAQ accordion uses it too, and a shared component must not depend on
 * a route-private file.
 */
export function OpenTargetDetails() {
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1)
      if (!id) return
      const el = document.getElementById(id)
      if (el instanceof HTMLDetailsElement) {
        el.open = true
        // Without this the deep link lands with focus still on <body>, so a
        // keyboard or screen-reader user arrives at the top of the document
        // rather than at the question they followed the link to. preventScroll
        // leaves the scroll position to scrollIntoView below.
        el.querySelector('summary')?.focus({ preventScroll: true })
        el.scrollIntoView({ block: 'start' })
      }
    }

    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

  return null
}
