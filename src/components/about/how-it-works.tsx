import Link from 'next/link'
import { Upload, Search, CheckCircle } from 'lucide-react'

interface Step {
  label: string
  description: string
}

interface HowItWorksProps {
  heading: string
  steps: [Step, Step, Step]
  cta: string
}

const STEP_ICONS = [Upload, Search, CheckCircle]

export default function HowItWorks({ heading, steps, cta }: HowItWorksProps) {
  return (
    <section className="py-12 md:py-16">
      <h2 className="font-heading text-xl font-bold">{heading}</h2>
      <div className="mt-8 flex flex-col gap-8 sm:flex-row">
        {steps.map(({ label, description }, i) => {
          const Icon = STEP_ICONS[i]
          return (
            <div key={i} className="flex-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                {i + 1}
              </div>
              <Icon className="mt-4 h-5 w-5 text-muted-foreground" />
              <h3 className="mt-2 font-heading text-base font-bold">{label}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          )
        })}
      </div>
      <div className="mt-8">
        <Link href="/submit" className="font-medium text-cta">
          {cta}
        </Link>
      </div>
    </section>
  )
}
