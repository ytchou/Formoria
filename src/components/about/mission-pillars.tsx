interface Pillar {
  heading: string
  body: string
}

interface MissionPillarsProps {
  heading: string
  pillars: [Pillar, Pillar, Pillar]
}

export default function MissionPillars({ heading, pillars }: MissionPillarsProps) {
  return (
    <section className="border-t border-border py-16 md:py-24">
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <h2 className="type-page-title-large">
          {heading}
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {pillars.map((pillar, index) => (
            <div key={pillar.heading} className="border-t border-border pt-5">
              <p className="type-eyebrow-cta">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-4 type-card-title">
                {pillar.heading}
              </h3>
              <p className="mt-3 type-body-muted">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
