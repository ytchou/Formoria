"use client";

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  MAX_SUBCATEGORIES,
  recordRejectedSubcategoryInput,
  resolveSubcategorySelection,
  type RejectedSubcategoryInput,
} from "@/lib/services/subcategories";
import {
  categoryLabel,
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  normalizeSubcategoryKey,
  subcategoryDisplayLabel,
  type L2Subcategory,
} from "@/lib/taxonomy/ontology";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Typography } from "@/components/ui/typography";

/**
 * Every string this picker renders arrives as a prop. The component lives
 * outside the admin allowlist in `no-hardcoded-cjk`, and its three surfaces
 * (owner wizard, visitor correction dialog, admin review) each own their copy
 * in a different message namespace.
 */
export type SubcategoryPickerLabels = {
  /** Visible label on the filter field — never a placeholder. */
  search: string;
  /** Static hint under the field: what the field does. */
  searchHint: string;
  /** Heading for the chips currently selected. Say that a click removes one. */
  selected: string;
  /** Heading for the offer set. */
  options: string;
  /** Shown when the cap is reached. */
  limit: string;
  /**
   * Shown when a typed term is not in the vocabulary. Must say how to FIX —
   * pick the closest chip below — not merely that the term was refused.
   */
  rejected: string;
  /** Shown when the filter matches no node. */
  empty: string;
};

type SubcategoryPickerProps = {
  /** Stored representation: ontology slugs. */
  value: string[];
  onChange: (next: string[]) => void;
  labels: SubcategoryPickerLabels;
  /**
   * Names the caller in the rejected-input log, so a vocabulary gap can be
   * traced to the surface that wanted the missing term.
   */
  surface: string;
  /** 'zh-TW' or 'en'. Anything else narrows to zh-TW. */
  locale?: string;
  /**
   * Values already stored before this edit. They stay in the selected row when
   * deselected, wearing the reference tone, so a removal is reversible without
   * hunting for the chip in a 175-item offer set.
   */
  baseline?: string[];
  /** L1 whose nodes are offered first. The other twelve still follow. */
  priorityCategorySlug?: string | null;
  /** Nodes to float to the top of their group — the directory's popular tags. */
  prioritySlugs?: readonly string[];
  max?: number;
  disabled?: boolean;
  /** Receives every rejection alongside the module-level log. */
  onRejectedInput?: (entry: RejectedSubcategoryInput) => void;
};

/** Everything a value can be matched on: slug, both names, every alias. */
function searchKeysFor(subcategory: L2Subcategory): string[] {
  return [
    subcategory.slug,
    subcategory.nameZh,
    subcategory.nameEn,
    ...subcategory.aliases,
  ].map(normalizeSubcategoryKey);
}

export function SubcategoryPicker({
  value,
  onChange,
  labels,
  surface,
  locale = "zh-TW",
  baseline = [],
  priorityCategorySlug = null,
  prioritySlugs = [],
  max = MAX_SUBCATEGORIES,
  disabled = false,
  onRejectedInput,
}: SubcategoryPickerProps) {
  const baseId = useId();
  const searchId = `${baseId}-search`;
  const searchHintId = `${baseId}-search-hint`;
  const messageId = `${baseId}-message`;
  const selectedHeadingId = `${baseId}-selected`;
  const optionsHeadingId = `${baseId}-options`;

  const [query, setQuery] = useState("");
  const [rejectedTerm, setRejectedTerm] = useState<string | null>(null);

  const atLimit = value.length >= max;
  const selectedSet = useMemo(() => new Set(value), [value]);
  // `categoryLabel` compares the tag exactly; 'zh' and 'zh-Hant' both reach it
  // from the three surfaces, and an unnarrowed tag silently renders English.
  const l1Locale = locale.startsWith("en") ? "en" : "zh-TW";
  const label = (slug: string) => subcategoryDisplayLabel(slug, locale);

  // Baseline first so a deselected original keeps its place, then the additions.
  const selectedRow = useMemo(() => {
    const seen = new Set<string>();
    const row: { slug: string; isBaseline: boolean }[] = [];
    for (const slug of [...baseline, ...value]) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      row.push({ slug, isBaseline: baseline.includes(slug) });
    }
    return row;
  }, [baseline, value]);

  const offerGroups = useMemo(() => {
    const alreadyShown = new Set(selectedRow.map((item) => item.slug));
    const key = normalizeSubcategoryKey(query);
    const priority = new Set(prioritySlugs);

    const categories = [
      ...L1_CATEGORIES.filter((item) => item.slug === priorityCategorySlug),
      ...L1_CATEGORIES.filter((item) => item.slug !== priorityCategorySlug),
    ];

    return categories
      .map((category) => {
        const nodes = L2_SUBCATEGORIES.filter(
          (subcategory) =>
            subcategory.category === category.slug &&
            !alreadyShown.has(subcategory.slug) &&
            (key === "" ||
              searchKeysFor(subcategory).some((candidate) =>
                candidate.includes(key),
              )),
        ).sort((left, right) => {
          const leftPriority = priority.has(left.slug) ? 0 : 1;
          const rightPriority = priority.has(right.slug) ? 0 : 1;
          return leftPriority - rightPriority;
        });
        return { category, nodes };
      })
      .filter((group) => group.nodes.length > 0);
  }, [priorityCategorySlug, prioritySlugs, query, selectedRow]);

  const visibleNodes = offerGroups.flatMap((group) => group.nodes);

  function select(slug: string) {
    if (selectedSet.has(slug) || value.length >= max) return;
    setRejectedTerm(null);
    onChange([...value, slug]);
  }

  function deselect(slug: string) {
    setRejectedTerm(null);
    onChange(value.filter((item) => item !== slug));
  }

  function reject(input: string) {
    setRejectedTerm(input);
    const entry = recordRejectedSubcategoryInput({ input, surface });
    onRejectedInput?.(entry);
  }

  /**
   * The one commit path. A typed term is only accepted when the closed
   * vocabulary knows it, or when the filter has narrowed the offer set to a
   * single node — that second case is a disambiguated selection, not free
   * text, and admitting it is what keeps half-typed terms out of the gap log.
   */
  function commitTypedTerm() {
    const typed = query.trim();
    if (!typed || disabled) return;

    const resolved = resolveSubcategorySelection(typed);
    if (resolved.ok) {
      if (!selectedSet.has(resolved.slug)) select(resolved.slug);
      setQuery("");
      return;
    }

    const onlyMatch = visibleNodes.length === 1 ? visibleNodes[0] : undefined;
    if (onlyMatch) {
      select(onlyMatch.slug);
      setQuery("");
      return;
    }

    reject(typed);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={searchId}>{labels.search}</Label>
        <Input
          id={searchId}
          value={query}
          disabled={disabled}
          autoComplete="off"
          aria-describedby={
            rejectedTerm ? `${searchHintId} ${messageId}` : searchHintId
          }
          aria-invalid={rejectedTerm ? true : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setRejectedTerm(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // A picker inside a form must not submit it from the filter field.
            event.preventDefault();
            commitTypedTerm();
          }}
          data-ph-no-autocapture
        />
        <p id={searchHintId} className="type-caption">
          {labels.searchHint}
        </p>
        {rejectedTerm ? (
          <p id={messageId} role="status" className="type-caption text-destructive">
            {labels.rejected}
          </p>
        ) : null}
      </div>

      <div
        role="group"
        aria-labelledby={selectedHeadingId}
        className="space-y-2"
      >
        <Typography id={selectedHeadingId} variant="subsectionTitle">
          {labels.selected}
        </Typography>
        {selectedRow.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {selectedRow.map((item) => {
              const pressed = selectedSet.has(item.slug);
              return (
                <ToggleChip
                  key={item.slug}
                  size="chip"
                  tone={item.isBaseline ? "reference" : "default"}
                  pressed={pressed}
                  // Re-selecting a removed chip is an add, and adds no-op at
                  // the cap — without this it would be a dead control.
                  disabled={disabled || (!pressed && atLimit)}
                  onPressedChange={(next) =>
                    next ? select(item.slug) : deselect(item.slug)
                  }
                  data-ph-no-autocapture
                >
                  {label(item.slug)}
                  {pressed ? <X aria-hidden="true" /> : null}
                </ToggleChip>
              );
            })}
          </div>
        )}
        {atLimit ? (
          <p className="type-caption" aria-live="polite">
            {labels.limit}
          </p>
        ) : null}
      </div>

      <div
        role="group"
        aria-labelledby={optionsHeadingId}
        className="space-y-3"
      >
        <Typography id={optionsHeadingId} variant="subsectionTitle">
          {labels.options}
        </Typography>
        {offerGroups.length === 0 ? (
          <p className="type-caption">{labels.empty}</p>
        ) : (
          offerGroups.map(({ category, nodes }) => (
            <div key={category.slug} className="space-y-1.5">
              <p className="type-caption text-muted-foreground">
                {categoryLabel(category, l1Locale)}
              </p>
              <div className="flex flex-wrap gap-2">
                {nodes.map((node) => (
                  <ToggleChip
                    key={node.slug}
                    size="chip"
                    pressed={false}
                    disabled={disabled || atLimit}
                    onPressedChange={() => select(node.slug)}
                    data-ph-no-autocapture
                  >
                    {label(node.slug)}
                  </ToggleChip>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
