import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

export default function BrandNotFound() {
  return (
    <main className="mx-auto flex max-w-screen-xl flex-col items-center justify-center px-6 py-24 md:px-10">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-foreground">
        Brand Not Found
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The brand you&apos;re looking for doesn&apos;t exist or hasn&apos;t been approved yet.
      </p>
      <Link
        href="/brands"
        className={buttonVariants({ variant: 'default' }) + ' mt-6'}
      >
        Browse all brands
      </Link>
    </main>
  )
}
