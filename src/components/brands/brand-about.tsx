import { cn } from "@/lib/utils";
import type { AppLocale } from "@/i18n/locale-preference";

/**
 * Story length (characters) from which the band sets in two columns at lg.
 * Below it a single 48rem column is at most about three lines and the blank
 * beside it is small; above it a lone column left x≈840–1376 empty at 1440
 * beside the story (BD2-04). Latin runs ~2.5× the characters per line.
 */
const TWO_COLUMN_MIN_CHARS: Record<AppLocale, number> = {
  "zh-TW": 140,
  en: 350,
};

/**
 * Whether the story sets in two columns at lg. The paragraphs rejoin to the
 * exact story text, so the threshold counts the same characters as before.
 */
export function isTwoColumnStory(
  paragraphs: string[],
  locale: AppLocale,
): boolean {
  return paragraphs.join("\n\n").length >= TWO_COLUMN_MIN_CHARS[locale];
}

interface BrandAboutProps {
  /** `buildBrandDetailView().storyParagraphs`: the story after the hero lede. */
  paragraphs: string[];
  twoColumn: boolean;
}

/**
 * The story section's body. The page sets it in `BrandSection` (#about); a
 * long story drops that section's reading cap at lg (`isTwoColumnStory`) and
 * sets in two columns across the page instead, each column still narrower
 * than the measure; DOM order is unchanged.
 */
export function BrandAbout({ paragraphs, twoColumn }: BrandAboutProps) {
  return (
    <div
      className={cn(
        "mt-4 space-y-3",
        twoColumn && "lg:columns-2 lg:gap-x-gutter",
      )}
    >
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="type-body">
          {paragraph.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
