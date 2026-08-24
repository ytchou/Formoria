"use client";

import {
  type MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
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
  baseline?: readonly string[];
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

/**
 * The filter index, built once at module load.
 *
 * It is derived entirely from compile-time constants, so rebuilding it per
 * keystroke bought nothing and cost ~700 `String.normalize('NFKC')` calls plus
 * a regex pass across all 175 nodes on every filter pass.
 */
const SEARCH_KEYS: ReadonlyMap<string, string[]> = new Map(
  L2_SUBCATEGORIES.map((subcategory) => [
    subcategory.slug,
    searchKeysFor(subcategory),
  ]),
);

/**
 * Shared empty defaults. A `[]` written as a default parameter is a NEW array
 * on every render, which silently defeats every `useMemo` that lists it as a
 * dependency — the 175-node scan then replays on each unrelated re-render of
 * the surrounding form.
 */
const NO_SLUGS: readonly string[] = [];

export function SubcategoryPicker({
  value,
  onChange,
  labels,
  surface,
  locale = "zh-TW",
  baseline = NO_SLUGS,
  priorityCategorySlug = null,
  prioritySlugs = NO_SLUGS,
  max = MAX_SUBCATEGORIES,
  disabled = false,
  onRejectedInput,
}: SubcategoryPickerProps) {
  const baseId = useId();
  const searchId = `${baseId}-search`;
  const searchHintId = `${baseId}-search-hint`;
  const messageId = `${baseId}-message`;
  const limitMessageId = `${baseId}-limit`;
  const selectedHeadingId = `${baseId}-selected`;
  const optionsHeadingId = `${baseId}-options`;

  const [query, setQuery] = useState("");
  const [rejectedTerm, setRejectedTerm] = useState<string | null>(null);
  // The chip a mutation should hand focus to once React has re-rendered.
  // A ref, not state: the effect below has to clear this after moving focus,
  // and clearing state synchronously inside an effect body is the cascading
  // re-render the react-hooks rule forbids. The value is only ever read by
  // that effect, so it never needs to drive a render.
  const pendingFocusRef = useRef<string | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

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
              (SEARCH_KEYS.get(subcategory.slug) ?? []).some((candidate) =>
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

  /**
   * Activating a chip unmounts it: the offer set excludes anything already
   * selected, so the button the user just pressed leaves the DOM and focus
   * falls to `<body>`. Re-entering a 175-button list at position zero for each
   * of up to five selections is the whole cost, so focus is moved deliberately
   * to the same node in its new row — the strongest rung of the announcement
   * ladder, and it lands on the chip that undoes what just happened.
   *
   * The selected row precedes the offer set in the DOM, so when a chip appears
   * in both (a deselected baseline value) `querySelector` finds the selected
   * one, which is where the user was.
   */
  useEffect(() => {
    const slug = pendingFocusRef.current;
    if (!slug) return;
    pendingFocusRef.current = null;
    // Slugs come from the closed ontology: kebab-case ASCII, no escaping.
    chipsRef.current
      ?.querySelector<HTMLElement>(`[data-subcategory-chip="${slug}"]`)
      ?.focus();
  }, [selectedRow, visibleNodes]);

  /**
   * The only writer of the pending focus target, delegated from the element
   * that already wraps every chip — both rows carry `data-subcategory-chip`,
   * so the delegation needs no markup of its own.
   *
   * Not the per-chip callbacks: a closure created inside `.map()` cannot be
   * proven deferred, so a ref write reached from one reads as a render-phase
   * access — and the rule follows the call, so pushing the write down into
   * `select` does not escape it. Not `select` for a second reason:
   * `commitTypedTerm` calls it too, and pulling focus out of a field the user
   * is still typing in is not an announcement. A click is exactly what
   * separates a chip activation from a typed-term commit, and keyboard
   * activation of a button emits one.
   */
  function rememberChipFocus(event: MouseEvent<HTMLDivElement>) {
    const chip = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-subcategory-chip]",
    );
    pendingFocusRef.current = chip?.dataset.subcategoryChip ?? null;
  }

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
    <div ref={chipsRef} onClick={rememberChipFocus} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={searchId}>{labels.search}</Label>
        <Input
          id={searchId}
          value={query}
          disabled={disabled}
          autoComplete="off"
          aria-describedby={`${searchHintId} ${messageId}`}
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
        <p id={searchHintId} className="type-metadata">
          {labels.searchHint}
        </p>
        {/*
          Mounted unconditionally and empty. A live region has to EXIST before
          its content changes for a screen reader to announce it; a region that
          appears together with its own text is routinely missed. `sr-only`
          keeps the empty state out of the visual flow without taking the node
          out of the accessibility tree, which `hidden` would.
        */}
        <p
          id={messageId}
          role="status"
          className={cn(
            "type-metadata text-danger",
            !rejectedTerm && "sr-only",
          )}
        >
          {rejectedTerm ? labels.rejected : ""}
        </p>
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
          <ChipRow>
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
                  onPressedChange={(next) => {
                    if (next) select(item.slug);
                    else deselect(item.slug);
                  }}
                  data-subcategory-chip={item.slug}
                  data-ph-no-autocapture
                >
                  {label(item.slug)}
                  {pressed ? <X aria-hidden="true" /> : null}
                </ToggleChip>
              );
            })}
          </ChipRow>
        )}
        {/* Same contract as the rejection region above: present, then filled. */}
        <p
          id={limitMessageId}
          role="status"
          className={cn("type-metadata", !atLimit && "sr-only")}
        >
          {atLimit ? labels.limit : ""}
        </p>
      </div>

      {/*
        The cap message describes THIS group: reaching the limit disables all
        175 chips at once, and a user tabbing into an inert group is owed the
        reason rather than left to infer it.
      */}
      <div
        role="group"
        aria-labelledby={optionsHeadingId}
        aria-describedby={limitMessageId}
        className="space-y-3"
      >
        <Typography id={optionsHeadingId} variant="subsectionTitle">
          {labels.options}
        </Typography>
        {offerGroups.length === 0 ? (
          <p className="type-metadata">{labels.empty}</p>
        ) : (
          offerGroups.map(({ category, nodes }) => (
            <div key={category.slug} className="space-y-1.5">
              <p className="type-metadata text-ink-muted">
                {categoryLabel(category, l1Locale)}
              </p>
              <ChipRow>
                {nodes.map((node) => (
                  <ToggleChip
                    key={node.slug}
                    size="chip"
                    pressed={false}
                    disabled={disabled || atLimit}
                    onPressedChange={() => {
                      select(node.slug);
                    }}
                    data-subcategory-chip={node.slug}
                    data-ph-no-autocapture
                  >
                    {label(node.slug)}
                  </ToggleChip>
                ))}
              </ChipRow>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
