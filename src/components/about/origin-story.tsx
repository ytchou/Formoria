interface OriginStoryProps {
  heading: string
  body1: string
  body2: string
  body3: string
}

export default function OriginStory({ heading, body1, body2, body3 }: OriginStoryProps) {
  return (
    <section className="py-12 md:py-16">
      <div className="page-gutter mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <h2 className="type-section-title-large">{heading}</h2>
            <p className="mt-6 type-hero text-balance" translate="no">
              FORMOSA <span className="text-cta">→</span> FORMORIA
            </p>
          </div>
          <div className="max-w-prose space-y-5">
            <p className="type-page-subtitle text-pretty">{body1}</p>
            <p className="type-body-muted text-pretty">{body2}</p>
            <p className="type-body-muted text-pretty">{body3}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
