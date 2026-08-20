import { PageShell } from "@/components/ui/page-shell";
import type { PublicMicrositeBrand } from "@/lib/brands/contracts";

type StoryProps = {
  brand: PublicMicrositeBrand;
  story?: PublicMicrositeBrand["siteContent"]["story"];
};

export function Story({ brand, story }: StoryProps) {
  if (!story) {
    return null;
  }

  return (
    <section className="py-12 md:py-16" aria-labelledby="microsite-story">
      {/* Gutter and measure both from the shell — see `hero.tsx`. The reading
        column inside it keeps its own cap, now named: the hand-written cap it
        replaces was already 48rem, so `prose-measure` is the same width with a
        reason attached. */}
      <PageShell measure="page">
        <div className="prose-measure space-y-gutter">
          <h2 id="microsite-story" className="type-section">
            品牌故事
          </h2>
          <p className="type-body">{story}</p>
          {brand.foundingYear && (
            <p className="type-metadata">創立於 {brand.foundingYear}</p>
          )}
        </div>
      </PageShell>
    </section>
  );
}
