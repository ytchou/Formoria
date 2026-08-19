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
 * Uses an intermediate reading width so inline photos support the surrounding
 * content without taking over the full article column. Keeps the existing 4:3
 * crop and vertical spacing.
 */
export function StoryFigure({ src, alt, caption }: StoryFigureProps) {
  return (
    <figure className="mx-auto mt-7 mb-6 w-full max-w-2xl">
      {/* Raw `<img>`, matching the `img` rule in `storyComponentMap`: authors
          write arbitrary remote URLs and there is no intrinsic size to hand
          `next/image`'s optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- remote author-supplied URL with no intrinsic size; see above. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="aspect-[4/3] w-full rounded-lg border border-border bg-muted object-cover"
      />
      {/* Left-aligned to the image's own edge, not centred: a centred caption
          under an off-centre-width image reads as a standalone line of prose
          rather than as the image's subtext. */}
      {caption ? <figcaption className="mt-2 type-metadata">{caption}</figcaption> : null}
    </figure>
  )
}
