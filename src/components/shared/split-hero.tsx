import Image from 'next/image'
import type { ReactNode } from 'react'

interface SplitHeroProps {
  imageSrc: string
  eyebrow: string
  headline: string
  subheadline: string
  children: ReactNode
}

export default function SplitHero({ imageSrc, eyebrow, headline, subheadline, children }: SplitHeroProps) {
  return (
    <section className="grid lg:grid-cols-[2fr_3fr]">
      <div className="relative min-h-[20rem] lg:min-h-[32rem]">
        <Image
          src={imageSrc}
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover object-right"
        />
      </div>
      <div className="page-gutter flex flex-col justify-center py-12 lg:py-16">
        <div>
          <p className="type-eyebrow-cta">
            {eyebrow}
          </p>
          <h1 className="mt-4 type-hero">
            {headline}
          </h1>
          <p className="mt-4 type-page-subtitle">
            {subheadline}
          </p>
          {children}
        </div>
      </div>
    </section>
  )
}
