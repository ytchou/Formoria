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
      <div className="flex flex-col justify-center px-8 py-12 md:px-12 lg:py-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-cta">
            {eyebrow}
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-foreground md:text-5xl">
            {headline}
          </h1>
          <p className="mt-4 text-base leading-[1.7] text-muted-foreground">
            {subheadline}
          </p>
          {children}
        </div>
      </div>
    </section>
  )
}
