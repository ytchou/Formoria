import type { Brand } from '@/lib/types'

interface BrandAboutProps {
  brand: Brand
}

export function BrandAbout({ brand }: BrandAboutProps) {
  if (!brand.description) return null

  const paragraphs = brand.description.split('\n\n')

  return (
    <section>
      <h2 className="mb-3 font-[family-name:var(--font-heading)] text-sm font-semibold text-foreground">
        About
      </h2>
      <div className="space-y-3">
        {paragraphs.map((paragraph, i) => (
          <p
            key={i}
            className="text-sm leading-relaxed text-muted-foreground"
          >
            {paragraph.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ))}
      </div>
    </section>
  )
}
