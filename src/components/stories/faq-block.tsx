import { Accordion, AccordionItem } from '@/components/ui/accordion'

type FaqItem = {
  q: string
  a: string
}

type FaqBlockProps = {
  questions?: FaqItem[] | null
}

export function FaqBlock({ questions }: FaqBlockProps) {
  const items = questions ?? []
  if (items.length === 0) return null

  return (
    <section>
      <Accordion>
        {items.map((item) => (
          <AccordionItem key={item.q} title={item.q}>
            {item.a}
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
