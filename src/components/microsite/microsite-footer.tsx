import type { PublicMicrositeBrand } from '@/lib/brands/contracts'

type MicrositeFooterProps = {
  brand: PublicMicrositeBrand
}

export function MicrositeFooter({ brand }: MicrositeFooterProps) {
  return (
    <footer className="px-6 pb-10 pt-6 md:px-10">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-gutter border-t border-rule pt-6 type-metadata sm:flex-row sm:items-center sm:justify-between">
        <a
          href={`https://formoria.com/brands/${brand.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit rounded-[2px] font-medium text-ink underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none"
        >
          Powered by Formoria
        </a>

        {brand.mitVerified === true && (
          <span className="inline-flex w-fit items-center rounded-full bg-verified-green-bg px-2.5 py-1 type-micro text-verified-green">
            MIT 微笑認證
          </span>
        )}
      </div>
    </footer>
  )
}
