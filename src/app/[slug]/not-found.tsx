import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

export default function BrandNotFound() {
  return (
    <main className="mx-auto flex max-w-screen-xl flex-col items-center justify-center px-6 py-24 md:px-10">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-foreground">
        找不到品牌
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        您尋找的品牌不存在或尚未通過審核。
      </p>
      <Link
        href="/"
        className={buttonVariants({ variant: 'default' }) + ' mt-6'}
      >
        瀏覽所有品牌
      </Link>
    </main>
  )
}
