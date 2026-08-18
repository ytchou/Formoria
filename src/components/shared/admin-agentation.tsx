'use client'

import dynamic from 'next/dynamic'

import { useUser } from '@/lib/auth/use-user'

// Lazy so the ~430KB toolbar bundle is a chunk only admins ever fetch. A static
// import would put it in every visitor's client graph even when it never renders.
const Agentation = dynamic(
  () => import('agentation').then((m) => m.Agentation),
  { ssr: false },
)

/**
 * Renders the Agentation annotation toolbar for admins in deployed
 * environments, and for anyone running the app locally.
 *
 * The deployed gate is `viewer.isAdmin`, which the server action behind
 * `ViewerProvider` derives from ADMIN_EMAILS — the same check
 * `admin-brand-menu` relies on. It is read client-side on purpose: awaiting
 * viewer context in the root layout would read cookies above every route and
 * de-opt the static/ISR pages to dynamic.
 *
 * Local development is exempt because the gate protects public visitors from a
 * ~430KB toolbar, and a dev server has none. Requiring ADMIN_EMAILS in
 * `.env.local` otherwise costs every developer their annotation tool with no
 * error to explain it — the toolbar is simply absent, which reads as a broken
 * install rather than a missing env var.
 */
export function AdminAgentation() {
  const { viewer, viewerLoading } = useUser()

  // `viewerLoading` starts true, so the server render and the hydration pass
  // both bail here — anything below this line only ever runs on the client.
  if (viewerLoading) return null
  // Read inside the component, not at module scope: Next inlines NODE_ENV into
  // the client bundle either way, and this keeps the branch reachable from a
  // test, which runs under NODE_ENV=test.
  const isLocalDevelopment = process.env.NODE_ENV === 'development'
  if (!isLocalDevelopment && !viewer.isAdmin) return null

  // Playwright signs in as an admin for the admin specs, and a floating toolbar
  // intercepts their clicks. The suppression has to be a client-side runtime
  // check: PLAYWRIGHT_TEST is unset during `next build`, so reading it on the
  // server bakes "not under test" into every prerendered page, and CI's
  // `PLAYWRIGHT_TEST=true pnpm start` can no longer correct it.
  if (navigator.webdriver) return null

  return <Agentation />
}
