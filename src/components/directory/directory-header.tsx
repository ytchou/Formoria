import type { ReactNode } from "react";

type DirectoryHeaderProps = {
  /** The page's h1 text. */
  title: ReactNode;
  /** One line under the title (the intro, or a result sentence in search mode). */
  intro?: ReactNode;
  /** The labelled search form, placed right of the title from `lg` up. */
  search?: ReactNode;
};

/**
 * The top of a listing page, shared by /discover and /brands: title and intro
 * on the left, the page's own search on the right, bottom-aligned with the
 * intro. Below `lg` the two stack and the search goes full width.
 *
 * Deliberately compact — listing pages lead with the grid. Future top content
 * (situation shortcuts, intro copy) belongs in a slot here, never in a
 * masthead that pushes the grid below the fold.
 */
export function DirectoryHeader({ title, intro, search }: DirectoryHeaderProps) {
  return (
    <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
      <div className="min-w-0 space-y-2">
        <h1 className="type-page-title">{title}</h1>
        {intro ? <p className="type-body">{intro}</p> : null}
      </div>
      {search ? <div className="w-full lg:w-xl lg:shrink-0">{search}</div> : null}
    </header>
  );
}
