// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../../messages/en.json";
import {
  CorrectionsQueue,
  type CorrectionQueueItem,
} from "../corrections-queue";

const NOVEL_TAG = "手工皂磨具";
const CANONICAL_TAG = "洋裝";
const NOVEL_MARKER = messages.admin.corrections.novelTag;

function tagCorrection(
  delta: { add: string[]; remove: string[] },
  currentTags: string[] = [],
): CorrectionQueueItem {
  return {
    id: "correction-1",
    brandName: "Test Brand",
    field: "product_tags",
    currentValue: currentTags,
    proposedValue: delta,
    stale: false,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function renderQueue(item: CorrectionQueueItem) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CorrectionsQueue corrections={[item]} />
    </NextIntlClientProvider>,
  );
}

/** The proposed-value cell is the only place the add/remove badges render. */
function proposedCell(): HTMLElement {
  const rows = screen.getAllByRole("row");
  const dataRow = rows[1];
  if (!dataRow) throw new Error("expected a correction row");
  const cells = within(dataRow).getAllByRole("cell");
  const cell = cells[3];
  if (!cell) throw new Error("expected a proposed-value cell");
  return cell;
}

describe("CorrectionsQueue novel-tag marker", () => {
  it("marks an add tag that is not in the taxonomy", () => {
    renderQueue(tagCorrection({ add: [NOVEL_TAG], remove: [] }));

    expect(within(proposedCell()).getAllByText(NOVEL_MARKER)).toHaveLength(1);
  });

  it("does not mark a canonical add tag", () => {
    renderQueue(tagCorrection({ add: [CANONICAL_TAG], remove: [] }));

    expect(within(proposedCell()).queryByText(NOVEL_MARKER)).toBeNull();
  });

  it("still renders the tag string itself for both", () => {
    renderQueue(tagCorrection({ add: [NOVEL_TAG, CANONICAL_TAG], remove: [] }));

    const cell = proposedCell();
    expect(within(cell).getByText(`+${NOVEL_TAG}`)).toBeInTheDocument();
    expect(within(cell).getByText(`+${CANONICAL_TAG}`)).toBeInTheDocument();
    // Additive, not a replacement: exactly one marker, for the novel tag only.
    expect(within(cell).getAllByText(NOVEL_MARKER)).toHaveLength(1);
  });

  it("does not mark remove badges", () => {
    renderQueue(tagCorrection({ add: [], remove: [NOVEL_TAG] }, [NOVEL_TAG]));

    const cell = proposedCell();
    expect(within(cell).getByText(`−${NOVEL_TAG}`)).toBeInTheDocument();
    expect(within(cell).queryByText(NOVEL_MARKER)).toBeNull();
  });
});
