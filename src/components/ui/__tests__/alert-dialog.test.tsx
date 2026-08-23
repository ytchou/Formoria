// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// `common.closeDialog` in both locales. `AlertDialog` must never grow a close
// affordance: an alert dialog is a decision, and a dismissal that is neither
// "confirm" nor "cancel" leaves the caller guessing which one it got.
const CLOSE_DIALOG_NAME = /Close dialog|關閉對話框/i;

function Fixture({
  destructive,
  size,
}: {
  destructive?: boolean;
  size?: "compact" | "panel" | "form" | "wide";
}) {
  return (
    <AlertDialog defaultOpen destructive={destructive}>
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this brand?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the brand from the directory.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
      screen.queryByRole("button", { name: CLOSE_DIALOG_NAME })
    ).toBeNull();

    rerender(<Fixture destructive />);

    expect(
      screen.queryByRole("button", { name: CLOSE_DIALOG_NAME })
    ).toBeNull();
    // Nothing that merely *looks* like a close control either.
    expect(
      screen.getAllByRole("button").map((button) => button.textContent)
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
      '[data-slot="alert-dialog-overlay"]'
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
      "panel"
    );

    for (const size of ["compact", "panel", "form", "wide"] as const) {
      rerender(<Fixture size={size} />);
      expect(screen.getByRole("alertdialog")).toHaveAttribute(
        "data-size",
        size
      );
    }
  });
});
