import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

interface CtaSectionProps {
  primaryLabel: string
  primaryHref: string
  secondaryLabel: string
  secondaryHref: string
}

export default function CtaSection({
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
}: CtaSectionProps) {
  return (
    <section className="bg-card py-12 md:py-16">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Link href={primaryHref} className={buttonVariants({ variant: 'default', size: 'lg' })}>
          {primaryLabel}
        </Link>
        <Link href={secondaryHref} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          {secondaryLabel}
        </Link>
      </div>
    </section>
  )
}
