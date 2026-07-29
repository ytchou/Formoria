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
const NOT_AVAILABLE = messages.admin.corrections.notAvailable;
const INSTAGRAM_URL = "https://instagram.com/foo";
const WEBSITE_URL = "https://example.com";

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

function linkCorrection(
  field: CorrectionQueueItem["field"],
  proposedUrl: string,
): CorrectionQueueItem {
  return {
    id: "correction-2",
    brandName: "Test Brand",
    field,
    currentValue: null,
    proposedValue: proposedUrl,
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

function dataCell(index: number): HTMLElement {
  const rows = screen.getAllByRole("row");
  const dataRow = rows[1];
  if (!dataRow) throw new Error("expected a correction row");
  const cells = within(dataRow).getAllByRole("cell");
  const cell = cells[index];
  if (!cell) throw new Error(`expected a cell at index ${index}`);
  return cell;
}

/** The proposed-value cell is the only place the add/remove badges render. */
function proposedCell(): HTMLElement {
  return dataCell(3);
}

function fieldCell(): HTMLElement {
  return dataCell(1);
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

describe("CorrectionsQueue link fields", () => {
  it("renders a proposed social link as its raw URL", () => {
    renderQueue(linkCorrection("social_instagram", INSTAGRAM_URL));

    const cell = proposedCell();
    expect(within(cell).getByText(INSTAGRAM_URL)).toBeInTheDocument();
    expect(within(cell).queryByText(NOT_AVAILABLE)).toBeNull();
  });

  it("labels a social link row from its field message key", () => {
    renderQueue(linkCorrection("social_instagram", INSTAGRAM_URL));

    expect(
      within(fieldCell()).getByText(
        messages.admin.corrections.fields.social_instagram,
      ),
    ).toBeInTheDocument();
  });

  it("still renders a proposed purchase link as its raw URL", () => {
    renderQueue(linkCorrection("purchase_website", WEBSITE_URL));

    const cell = proposedCell();
    expect(within(cell).getByText(WEBSITE_URL)).toBeInTheDocument();
    expect(within(cell).queryByText(NOT_AVAILABLE)).toBeNull();
  });
});
