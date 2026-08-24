// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-TW.json";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DIALOG_SIZES, type DialogSize } from "@/components/ui/dialog";

// `common.closeDialog` in both locales, READ FROM THE CATALOGUES. This test's
// whole job is asserting an ABSENCE, so a hardcoded copy of the string is the
// one kind of drift it cannot survive: retranslate `common.closeDialog` and a
// literal regex matches nothing that renders, the assertion passes vacuously,
// and it would keep passing after `AlertDialogContent` grew a close button.
//
// `AlertDialog` must never grow one: an alert dialog is a decision, and a
// dismissal that is neither "confirm" nor "cancel" leaves the caller guessing
// which one it got.
const CLOSE_DIALOG_NAME = new RegExp(
  [enMessages.common.closeDialog, zhMessages.common.closeDialog]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "i",
);

function Fixture({
  destructive,
  size,
}: {
  destructive?: boolean;
  size?: DialogSize;
}) {
  return (
    <AlertDialog defaultOpen destructive={destructive}>
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this brand?</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>
            This removes the brand from the directory.
          </AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          {/* Rendered before Cancel on purpose: if `initialFocus` were not
              wired, Base UI would focus this first tabbable element instead. */}
          <Button variant="primary">Delete</Button>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe("AlertDialog", () => {
  it("has no close button in any configuration", () => {
    const { rerender } = render(<Fixture />);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: CLOSE_DIALOG_NAME }),
    ).toBeNull();

    rerender(<Fixture destructive />);

    expect(
      screen.queryByRole("button", { name: CLOSE_DIALOG_NAME }),
    ).toBeNull();
    // Nothing that merely *looks* like a close control either.
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Delete", "Cancel"]);
  });

  it("destructive puts initial focus on Cancel", async () => {
    render(<Fixture destructive />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
  });

  it("destructive blocks Escape and outside dismissal", async () => {
    render(<Fixture destructive />);

    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.getByRole("alertdialog")).toBe(dialog);

    const backdrop = document.querySelector(
      '[data-slot="alert-dialog-overlay"]',
    );
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.mouseDown(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(screen.getByRole("alertdialog")).toBe(dialog);
  });

  it("non-destructive dismisses on Escape", async () => {
    render(<Fixture />);

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("size maps to a data-size attribute, defaulting to panel", () => {
    const { rerender } = render(<Fixture />);

    expect(screen.getByRole("alertdialog")).toHaveAttribute(
      "data-size",
      "panel",
    );

    // The one list, from `dialog.tsx` — a fifth name is covered here without
    // an edit rather than silently untested.
    for (const size of DIALOG_SIZES) {
      rerender(<Fixture size={size} />);
      expect(screen.getByRole("alertdialog")).toHaveAttribute(
        "data-size",
        size,
      );
    }
  });
});
