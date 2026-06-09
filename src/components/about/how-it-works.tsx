import { Link } from '@/i18n/navigation'

interface Step {
  label: string
  description: string
}

interface HowItWorksProps {
  heading: string
  steps: [Step, Step, Step]
  cta: string
}

export default function HowItWorks({ heading, steps, cta }: HowItWorksProps) {
  return (
    <section className="border-t border-border py-16 md:py-24">
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <h2 className="font-heading text-3xl font-bold leading-tight text-foreground md:text-4xl">
          {heading}
        </h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map(({ label, description }, index) => (
            <li key={label}>
              <p className="font-heading text-3xl font-bold text-primary/30">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-4 font-heading text-lg font-bold text-foreground">
                {label}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-lg">
                {description}
              </p>
            </li>
          ))}
        </ol>
        <Link href="/submit" className="mt-10 inline-flex text-sm font-semibold text-primary hover:underline">
          {cta}
        </Link>
      </div>
    </section>
  )
}
