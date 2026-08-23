// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import enMessages from "../../../../messages/en.json";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogStatus,
  DialogTitle,
  type DialogSize,
} from "@/components/ui/dialog";

const CLOSE_NAME = enMessages.common.closeDialog;

function renderDialog(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Dialog open>{children}</Dialog>
    </NextIntlClientProvider>,
  );
}

function slot(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!el) throw new Error(`no [data-slot="${name}"] in the document`);
  return el;
}

describe("Dialog", () => {
  it("renders one close button by default", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
        </DialogHeader>
        <DialogBody>body</DialogBody>
      </DialogContent>,
    );

    // The name describes the ACTION. One button, not two: a second close in
    // the footer would give the same action two focus stops with one name.
    const closes = screen.getAllByRole("button", { name: CLOSE_NAME });
    expect(closes).toHaveLength(1);
    expect(slot("dialog-content").contains(closes[0])).toBe(true);
  });

  it("size maps to a data-size attribute", () => {
    const sizes: DialogSize[] = ["compact", "panel", "form", "wide"];

    for (const size of sizes) {
      const { unmount } = renderDialog(
        <DialogContent size={size}>
          <DialogHeader>
            <DialogTitle>{size}</DialogTitle>
          </DialogHeader>
        </DialogContent>,
      );

      expect(slot("dialog-content")).toHaveAttribute("data-size", size);
      unmount();
    }

    // A dialog with nothing said about it is a form — the shape six call
    // sites had already reached by hand.
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>default</DialogTitle>
        </DialogHeader>
      </DialogContent>,
    );
    expect(slot("dialog-content")).toHaveAttribute("data-size", "form");
  });

  it("DialogBody owns the scroll container", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Long form</DialogTitle>
        </DialogHeader>
        <DialogBody>body</DialogBody>
      </DialogContent>,
    );

    const body = slot("dialog-body");
    expect(body.className).toContain("overflow-y-auto");
    // Without `min-h-0` the grid child refuses to shrink below its content and
    // the overflow never engages — the half that is easy to drop.
    expect(body.className).toContain("min-h-0");

    // The popup itself must NOT scroll: it would take the header and the close
    // button with it.
    const content = slot("dialog-content");
    expect(content.className).not.toContain("overflow-y-auto");
    expect(content.className).not.toContain("overflow-auto");
  });

  it("DialogStatus renders a message and its actions", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Loading</DialogTitle>
        </DialogHeader>
        <DialogStatus
          message="We could not load this report."
          actions={
            <>
              <button type="button">Retry</button>
              <button type="button">Dismiss</button>
            </>
          }
        />
      </DialogContent>,
    );

    expect(screen.getByText("We could not load this report.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();

    // A status branch never has enough content to scroll, and a scroll
    // container around one sentence is what makes an error message look like
    // a truncated one.
    expect(document.querySelector('[data-slot="dialog-body"]')).toBeNull();
    expect(slot("dialog-status").className).not.toContain("overflow-y-auto");
  });

  it("DialogStatus accepts children in place of message", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sent</DialogTitle>
        </DialogHeader>
        <DialogStatus actions={<button type="button">Done</button>}>
          <p data-testid="custom-status">Thank you — we will take a look.</p>
        </DialogStatus>
      </DialogContent>,
    );

    // The escape hatch for the one branch that is real markup, rendered in the
    // same shell rather than behind a `tone` axis.
    expect(screen.getByTestId("custom-status")).toBeTruthy();
    const done = screen.getByRole("button", { name: "Done" });
    expect(slot("dialog-footer").contains(done)).toBe(true);
  });

  it("DialogHeader renders an icon when given one", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader icon={<span data-testid="header-icon">!</span>}>
          <DialogTitle>Delete this brand</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
      </DialogContent>,
    );

    expect(screen.getByTestId("header-icon")).toBeTruthy();

    // The icon is decoration beside the title, never the name of the dialog.
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Delete this brand",
    );
  });

  it("spells the viewport gutter on an axis the size branch cannot outrank", () => {
    renderDialog(
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Workspace</DialogTitle>
        </DialogHeader>
      </DialogContent>,
    );

    const classes = slot("dialog-content").className.split(/\s+/);

    // As a max-width the gutter shared both the `sm` media query AND the
    // `max-width` property with the size branch, and lost: the branch's
    // selector carries the class plus `[data-size="wide"]` (0,2,0) against the
    // gutter's class alone (0,1,0), and tailwind-merge keeps both because their
    // modifier sets differ. A `size="wide"` dialog on a 700px window then took
    // the full 700px and touched both screen edges. As a WIDTH it sets a
    // different property, so the two compose instead of competing.
    expect(classes).toContain("sm:w-[calc(100%-2rem)]");
    expect(classes).toContain("data-[size=wide]:sm:overlay-wide");
    expect(classes.filter((cls) => /^sm:max-w-/.test(cls))).toEqual([]);
  });

  it("a call site can lift the mobile height cap", () => {
    renderDialog(
      // What the expo floor map needs: a documented fullscreen exemption that
      // must reach the top of a phone viewport rather than dock as a sheet.
      <DialogContent className="max-h-none">
        <DialogHeader>
          <DialogTitle>Floor map</DialogTitle>
        </DialogHeader>
      </DialogContent>,
    );

    const classes = slot("dialog-content").className.split(/\s+/);

    // Unprefixed against unprefixed: same tailwind-merge group, same (empty)
    // modifier set, so the base cap is REMOVED rather than left to fight the
    // override at equal specificity in an emission order nothing can pin.
    // `max-h-none` needed registering in `src/lib/utils` for this to hold —
    // tailwind-merge does not ship `none` in its own `max-h` scale.
    expect(classes).toContain("max-h-none");
    expect(classes).not.toContain("max-h-[85dvh]");
  });

  it("DialogStatus announces its result", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
        </DialogHeader>
        <DialogStatus message="Thank you — we will take a look." />
      </DialogContent>,
    );

    // Every status branch replaces a form in place after an async submit, and
    // the focused submit button leaves the tree with it. Without a live region
    // the reader submits and hears nothing.
    const status = screen.getByRole("status");
    expect(status).toBe(slot("dialog-status"));
    expect(status).toHaveTextContent("Thank you — we will take a look.");
  });

  it("DialogStatus falls back to message when a conditional child renders nothing", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
        </DialogHeader>
        {/* `{showDetail && <Detail />}` with the flag off: `false` is defined,
            so `??` kept it and the status rendered empty. */}
        <DialogStatus message="We could not load this report.">
          {false}
        </DialogStatus>
      </DialogContent>,
    );

    expect(screen.getByText("We could not load this report.")).toBeTruthy();
  });

  it("DialogFooter does not bleed", () => {
    renderDialog(
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Save</button>
        </DialogFooter>
      </DialogContent>,
    );

    // The old footer pulled itself out of a padded popup with `-mx-4 -mb-4`,
    // which only lined up while the popup's padding was exactly that number.
    // Padding now belongs to the sections, so any negative margin is a bug.
    const footer = slot("dialog-footer");
    for (const cls of footer.className.split(/\s+/)) {
      expect(cls).not.toMatch(/(^|:)-m[xytrbl]?-/);
    }
    expect(footer.className).toContain("border-t");
  });
});
