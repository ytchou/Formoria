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
    <section
      className="px-6 py-12 md:px-10 md:py-16"
      aria-labelledby="microsite-story"
    >
      <div className="mx-auto max-w-[1280px]">
        <div className="max-w-3xl space-y-gutter">
          <h2 id="microsite-story" className="type-section">
            品牌故事
          </h2>
          <p className="type-body">{story}</p>
          {brand.foundingYear && (
            <p className="type-metadata">創立於 {brand.foundingYear}</p>
          )}
        </div>
      </div>
    </section>
  );
}
