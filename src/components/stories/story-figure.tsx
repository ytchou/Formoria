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
 * Capped at `max-w-md` and centred: the story page runs the standard
 * `max-w-screen-xl` container, where a full-width 4:3 photo renders 1200x900 —
 * taller than a laptop viewport, so one image became a full-screen break in
 * the middle of a paragraph. An inline photo illustrates the paragraph around
 * it; it is not the reason the reader is on the page.
 */
export function StoryFigure({ src, alt, caption }: StoryFigureProps) {
  return (
    <figure className="mx-auto my-6 w-full max-w-md">
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
      {caption ? <figcaption className="mt-2 type-caption">{caption}</figcaption> : null}
    </figure>
  )
}
