import Link from 'next/link'

const footerLinks = [
  { label: '關於我們', href: '/about' },
  { label: '服務條款', href: '/terms' },
  { label: '聯絡我們', href: 'mailto:patrick.ytchou@gmail.com' },
]

export function Footer() {
  return (
    <footer
      role="contentinfo"
      className="bg-accent text-accent-foreground py-6"
    >
      <div className="mx-auto max-w-screen-xl px-6 md:px-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-6">
          {footerLinks.map((link) =>
            link.href.startsWith('/') ? (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-accent-foreground/70 hover:text-accent-foreground transition-colors"
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-foreground/70 hover:text-accent-foreground transition-colors"
              >
                {link.label}
              </a>
            )
          )}
        </div>
        <p className="text-xs text-accent-foreground/50">
          © {new Date().getFullYear()} MIT Map
        </p>
      </div>
    </footer>
  )
}
