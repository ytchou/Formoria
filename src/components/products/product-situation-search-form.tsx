import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        <Label htmlFor="discover-search-q" className="text-ink-muted mb-1">
          {labels.label}
        </Label>
        <Input
          id="discover-search-q"
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder={labels.placeholder}
          autoComplete="off"
        />
      </div>

      <Button type="submit" variant="primary" className="shrink-0">
        {labels.submit}
      </Button>
    </form>
  );
}
