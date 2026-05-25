import Link from 'next/link'

export default function Manifesto() {
  return (
    <section className="bg-background py-12 md:py-16">
      <div className="max-w-2xl">
        <p className="text-sm leading-[1.8] text-muted-foreground">
          「台灣製造」不只是一個標籤，而是一份對品質的堅持。從在地食材到設計選品，台灣有太多默默耕耘的品牌，等待被看見。
        </p>
        <p className="mt-4 text-sm leading-[1.8] text-muted-foreground">
          MIT Map 想做的，就是成為這些品牌與世界之間的橋樑——讓每一個用心做好產品的人，都有機會被發現。
        </p>
        <div className="mt-6">
          <Link href="/about" className="font-medium text-primary">
            了解我們的故事 →
          </Link>
        </div>
      </div>
    </section>
  )
}
