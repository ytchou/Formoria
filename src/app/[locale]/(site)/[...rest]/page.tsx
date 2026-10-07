import { notFound } from 'next/navigation'

// Catch-all for localized paths that match no route (next-intl's documented
// pattern). Without it, `/en/unknown` falls through to Next's unstyled default
// 404; calling notFound() here renders `(site)/not-found.tsx` inside the site
// shell with the request's locale. The proxy also rewrites its own 404s
// (unknown bare brand slugs, malformed brand slugs) onto this route.

// Throwing from generateMetadata too is what makes Next resolve the
// not-found boundary's metadata (noindex, no canonical/hreflang). A notFound()
// thrown only during render leaves the layouts' homepage metadata in place.
export function generateMetadata(): never {
  notFound()
}

export default function CatchAllNotFound() {
  notFound()
}
