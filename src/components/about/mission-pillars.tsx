import { Globe, Heart, Layers } from 'lucide-react'

interface Pillar {
  heading: string
  description: string
}

interface MissionPillarsProps {
  heading: string
  pillars: [Pillar, Pillar, Pillar]
}

const ICONS = [Globe, Heart, Layers]

export default function MissionPillars({ heading, pillars }: MissionPillarsProps) {
  return (
    <section className="py-12 md:py-16">
      <h2 className="font-heading text-xl font-bold">{heading}</h2>
      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3">
        {pillars.map(({ heading: pillarHeading, description }, i) => {
          const Icon = ICONS[i]
          return (
            <div key={pillarHeading} className="rounded-xl bg-card p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-heading text-base font-bold">{pillarHeading}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
