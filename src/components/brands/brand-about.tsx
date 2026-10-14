interface BrandAboutProps {
  /** `buildBrandDetailView().storyParagraphs`: the story after the hero lede. */
  paragraphs: string[];
}

/**
 * The story section's body. The page sets it in `BrandSection` (#about), one
 * column capped by the section's `prose-measure` (BD-05).
 */
export function BrandAbout({ paragraphs }: BrandAboutProps) {
  return (
    <div className="mt-4 space-y-3">
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
