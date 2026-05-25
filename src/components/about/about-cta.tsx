import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

export default function AboutCta() {
  return (
    <section className="bg-card py-12 md:py-16">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Link href="/brands" className={buttonVariants({ variant: 'default', size: 'lg' })}>
          探索品牌
        </Link>
        <Link href="/submit" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          提交品牌
        </Link>
      </div>
    </section>
  )
}
