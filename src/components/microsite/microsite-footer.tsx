import type { Brand } from '@/lib/types/brand'

type MicrositeFooterProps = {
  brand: Brand
}

export function MicrositeFooter({ brand }: MicrositeFooterProps) {
  return (
    <footer className="px-6 pb-10 pt-6 md:px-10">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <a
          href={`https://formoria.com/brands/${brand.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Powered by Formoria
        </a>

        {brand.mitVerified === true && (
          <span className="inline-flex w-fit items-center rounded-full bg-[var(--verified-green-bg,#EAF3E8)] px-2.5 py-1 text-[11px] font-semibold text-[var(--verified-green,#2D5A27)]">
            MIT 已驗證
          </span>
        )}
      </div>
    </footer>
  )
}
