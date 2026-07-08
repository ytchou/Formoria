import type { Brand } from '@/lib/types/brand'

type MicrositeFooterProps = {
  brand: Brand
}

export function MicrositeFooter({ brand }: MicrositeFooterProps) {
  return (
    <footer className="px-6 pb-10 pt-6 md:px-10">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 border-t border-border pt-6 type-caption sm:flex-row sm:items-center sm:justify-between">
        <a
          href={`https://formoria.com/brands/${brand.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-4 hover:underline"
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
