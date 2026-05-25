import { Suspense } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { SearchInput } from '@/components/brands/search-input'

export function HeroSection() {
  return (
    <section className="bg-background py-16 md:py-24">
      <div className="mx-auto max-w-3xl px-6 text-center md:px-10">
        <h1 className="font-heading text-4xl font-bold leading-tight lg:text-6xl">
          探索台灣製造的精品品牌
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Discover quality brands made in Taiwan
        </p>
        <div className="mt-8">
          <Suspense>
            <SearchInput redirectTo="/brands" placeholder="搜尋品牌..." />
          </Suspense>
        </div>
        <Link
          href="/brands"
          className={buttonVariants({ variant: 'default', size: 'lg' }) + ' mt-6'}
        >
          探索品牌
        </Link>
      </div>
    </section>
  )
}

export default HeroSection
