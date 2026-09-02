import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

type ProductSituationSearchFormProps = {
  locale: string;
  query: string | null;
  category: string | null;
  subcategories: string[];
  materials: string[];
  labels: {
    label: string;
    placeholder: string;
    submit: string;
  };
};

/**
 * A GET form for situation search on /discover.
 *
 * Server component — no "use client". Submits as a plain GET so the URL is
 * shareable and the page re-renders server-side with the `q` param.
 *
 * Hidden inputs preserve the active taxonomy filters across submissions.
 */
export function ProductSituationSearchForm({
  locale,
  query,
  category,
  subcategories,
  materials,
  labels,
}: ProductSituationSearchFormProps) {
  return (
    <form
      method="get"
      action={`/${locale}${routes.discover()}`}
      className="flex items-end gap-3"
    >
      {/* Preserve active taxonomy filters */}
      {category && <input type="hidden" name="category" value={category} />}
      {subcategories.length > 0 && (
        <input type="hidden" name="sub" value={subcategories.join(",")} />
      )}
      {materials.length > 0 && (
        <input type="hidden" name="material" value={materials.join(",")} />
      )}

      <div className="flex-1">
        {/* eslint-disable no-restricted-syntax -- ui-exception: server component cannot use client-side Label/Input */}
        <label htmlFor="discover-search-q" className="type-metadata text-ink-muted mb-1 block">
          {labels.label}
        </label>
        <input id="discover-search-q" type="search" name="q" defaultValue={query ?? ""} placeholder={labels.placeholder} className="h-11 w-full min-w-0 rounded-control border border-rule bg-transparent px-3.5 py-2 font-hei type-body text-ink transition-colors outline-none placeholder:text-ink-muted/50 focus-visible:ring-2 focus-visible:ring-accent" autoComplete="off" />
        {/* eslint-enable no-restricted-syntax */}
      </div>

      <Button type="submit" variant="primary" className="shrink-0">
        {labels.submit}
      </Button>
    </form>
  );
}
