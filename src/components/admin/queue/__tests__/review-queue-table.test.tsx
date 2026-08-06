// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useReviewQueue } from "../use-review-queue";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import type { ReviewBulkAction, ReviewColumn } from "../types";
import { ReviewQueueTable } from "../review-queue-table";

type Row = {
  id: string;
  name: string;
};

const rows: Row[] = [
  { id: "row-a", name: "Alpha" },
  { id: "row-b", name: "Beta" },
];

const nameColumn: ReviewColumn<Row> = {
  id: "name",
  header: "Name",
  cell: (item) => item.name,
};

function QueueTableHarness({
  items = rows,
  selectionEnabled = true,
  columns = [nameColumn],
  bulkActions,
  onRowActivate,
  rowActions,
}: {
  items?: Row[];
  selectionEnabled?: boolean;
  columns?: ReviewColumn<Row>[];
  bulkActions?: ReviewBulkAction<Row>[];
  onRowActivate?: (item: Row) => void;
  rowActions?: (item: Row) => React.ReactNode;
}) {
  const queue = useReviewQueue({
    items,
    getId: (item) => item.id,
    pageSize: null,
    ...(selectionEnabled ? { isSelectable: () => true } : {}),
  });

  return (
    <ReviewQueueTable
      queue={queue}
      columns={columns}
      emptyMessage="No reviews"
      getRowName={(item) => item.name}
      bulkActions={bulkActions}
      onRowActivate={onRowActivate}
      rowActions={rowActions}
    />
  );
}

describe("ReviewQueueTable", () => {
  it("renders a permanently visible disclosure button per row", () => {
    render(<QueueTableHarness />);

    const disclosureButtons = screen.getAllByRole("button", {
      name: /Show details for/,
    });

    expect(disclosureButtons).toHaveLength(rows.length);
    for (const button of disclosureButtons) {
      expect(button).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("omits the selection column when isSelectable is not provided", () => {
    render(<QueueTableHarness selectionEnabled={false} />);

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("select-all checkbox announces indeterminate state", () => {
    render(<QueueTableHarness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all visible rows",
    });
    expect(selectAll).toHaveProperty("indeterminate", true);
  });

  it("row click ignores clicks on interactive descendants", () => {
    const onRowActivate = vi.fn();
    const actionColumn: ReviewColumn<Row> = {
      id: "action",
      header: "Action",
      cell: () => <Button type="button">Inner action</Button>,
    };

    render(
      <QueueTableHarness
        columns={[nameColumn, actionColumn]}
        onRowActivate={onRowActivate}
      />,
    );

    const innerAction = screen
      .getAllByRole("button", { name: "Inner action" })
      .at(0);
    if (!innerAction) throw new Error("expected an inner action button");
    fireEvent.click(innerAction);
    expect(onRowActivate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Alpha"));
    const firstRow = rows.at(0);
    if (!firstRow) throw new Error("expected the first row");
    expect(onRowActivate).toHaveBeenCalledWith(firstRow);
  });

  it("renders the empty state row when there are no items", () => {
    render(<QueueTableHarness items={[]} />);

    expect(screen.getByText("No reviews")).toBeInTheDocument();
  });

  it("bulk buttons include the selected count in their accessible name", () => {
    const bulkAction: ReviewBulkAction<Row> = {
      id: "approve",
      label: (count) => `Approve ${count} selected`,
      onRun: vi.fn(),
    };

    render(<QueueTableHarness bulkActions={[bulkAction]} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all visible rows" }),
    );

    expect(
      screen.getByRole("button", { name: "Approve 2 selected" }),
    ).toBeInTheDocument();
  });
});
