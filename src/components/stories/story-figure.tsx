interface StoryFigureProps {
  src: string
  /** Describes the photo for a screen reader. Never the caption text. */
  alt: string
  /**
   * Subtext under the image, rendered verbatim. Any credit prefix is authored
   * in the MDX, not added here: a caption is not always a credit, and a
   * component that hard-codes one word cannot carry the other kinds.
   */
  caption?: string
}

/**
 * `<Figure src="…" alt="…" caption="…" />` inside story MDX.
 *
 * A shortcode rather than literal `<figure>`/`<figcaption>` JSX, because the
 * `storyComponentMap` overrides only reach markdown-generated elements and
 * capitalized shortcodes — literal lowercase JSX renders through Tailwind
 * preflight with no styling at all, which produced a 1200x1500 unstyled image.
 *
 * Every prop is a plain string: MDX drops expression attributes (`prop={…}`)
 * in this setup (DEV-1302), so a shortcode that needs an object or array is a
 * shortcode that silently receives nothing.
 *
 * Bounded by `prose-measure`, the same reading width the body copy runs at. On
 * a story that is the width of the shell already, so a figure fills its reading
 * column; on a wider surface the cap is what keeps an inline photo from growing
 * past the text it illustrates. Keeps the existing 4:3 crop and spacing.
 */
export function StoryFigure({ src, alt, caption }: StoryFigureProps) {
  return (
    <figure className="prose-measure mx-auto mt-7 mb-6 w-full">
      {/* Raw `<img>`, matching the `img` rule in `storyComponentMap`: authors
          write arbitrary remote URLs and there is no intrinsic size to hand
          `next/image`'s optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- remote author-supplied URL with no intrinsic size; see above. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="aspect-media w-full rounded-[3px] border border-rule bg-surface-deep object-cover"
      />
      {/* Left-aligned to the image's own edge, not centred: a centred caption
          under an off-centre-width image reads as a standalone line of prose
          rather than as the image's subtext. */}
      {caption ? <figcaption className="mt-2 type-metadata">{caption}</figcaption> : null}
    </figure>
  )
}
