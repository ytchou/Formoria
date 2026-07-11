interface OriginStoryProps {
  heading: string
  body1: string
  body2: string
  body3: string
}

export default function OriginStory({ heading, body1, body2, body3 }: OriginStoryProps) {
  return (
    <section className="py-16 md:py-24">
      <div className="page-gutter mx-auto max-w-5xl">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div>
            <h2 className="type-page-title-large">
              {heading}
            </h2>
            <span className="mt-6 block h-0.5 w-10 bg-cta" />
          </div>
          <div className="max-w-prose space-y-5 text-base leading-relaxed text-muted-foreground md:text-lg">
            <p>{body1}</p>
            <p>{body2}</p>
            <p>{body3}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
