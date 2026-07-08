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
        <h2 className="type-page-title-large">
          {heading}
        </h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map(({ label, description }, index) => (
            <li key={label} className="border-t border-border pt-5">
              <p className="type-eyebrow-cta">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-4 type-card-title">
                {label}
              </h3>
              <p className="mt-3 type-body-muted">
                {description}
              </p>
            </li>
          ))}
        </ol>
        <Link href="/submit" className="mt-10 inline-flex type-link">
          {cta}
        </Link>
      </div>
    </section>
  )
}
