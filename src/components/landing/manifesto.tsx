import Image from 'next/image'
import Link from 'next/link'

export default function Manifesto() {
  return (
    <section className="relative py-16 md:py-24">
      <Image
        src="/images/manifesto-bg.png"
        alt=""
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-10">
        <h2 className="font-heading text-3xl font-bold leading-tight text-white lg:text-5xl">
          讓台灣品牌被世界看見
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-white/80">
          台灣製造不只是一個標籤，而是一份對品質的堅持。從在地食材到設計選品，台灣有太多默默耕耘的品牌，等待被看見。
        </p>
        <p className="mt-3 text-lg leading-relaxed text-white/80">
          Formoria 想成為這些品牌與世界之間的橋樑——讓每一個用心做好產品的人，都有機會被發現。
        </p>
        <Link
          href="/about"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
        >
          了解我們的故事
        </Link>
      </div>
    </section>
  )
}
