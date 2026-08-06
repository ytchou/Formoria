"use client";

import type { ReactNode } from "react";

import { BrandDetailSheet } from "@/components/admin/brand-detail-sheet";

export function ReviewQueueDrawer<T>(props: {
  item: T | null;
  open?: boolean;
  onClose: () => void;
  title: (item: T) => string;
  metadata?: (item: T) => ReactNode;
  /**
   * OPTIONAL, and omitting it is a first-class call shape: when the drawer body
   * already renders the id itself, passing `bodyId` here emits a DUPLICATE DOM
   * id and any strict-mode locator resolves to two nodes. Submissions is
   * exactly this case — `ReviewDetailsEditor` renders
   * `id={entityId}` = `submission-review-${id}`, which
   * `admin-submission-enrichment.spec.ts:198` locates.
   *
   * `ReviewQueueTable.disclosureControlsId` is independent of this prop, so
   * `aria-controls` can point at an id the drawer does not itself render. When
   * omitted, no wrapper id attribute is emitted at all.
   */
  bodyId?: (item: T) => string;
  children: (item: T) => ReactNode;
  footer?: (item: T) => ReactNode;
}): React.JSX.Element | null {
  const { item, onClose, title, metadata, bodyId, children, footer } = props;
  if (item === null) return null;

  return (
    <BrandDetailSheet
      open={props.open ?? Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title(item)}
      metadata={metadata?.(item)}
    >
      <div id={bodyId?.(item)}>{children(item)}</div>
      {footer ? <div className="border-t">{footer(item)}</div> : null}
    </BrandDetailSheet>
  );
}
