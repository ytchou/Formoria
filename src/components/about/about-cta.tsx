import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function AboutCta() {
  return (
    <section className="bg-card py-12 md:py-16">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Button asChild size="lg">
          <Link href="/brands">探索品牌</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/submit">提交品牌</Link>
        </Button>
      </div>
    </section>
  )
}
