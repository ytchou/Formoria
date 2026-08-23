// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../../messages/en.json";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function renderSheet(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Sheet", () => {
  it("SheetBody owns the scroll container", () => {
    renderSheet(<SheetBody>Filters</SheetBody>);

    const body = document.querySelector('[data-slot="sheet-body"]');
    expect(body).not.toBeNull();
    const classes = (body as HTMLElement).className.split(/\s+/);
    expect(classes).toContain("min-h-0");
    expect(classes).toContain("flex-1");
    expect(classes).toContain("overflow-y-auto");
  });

  it("size maps to a data-size attribute, defaulting to panel", () => {
    const { unmount } = renderSheet(
      <Sheet open>
        <SheetContent side="right" size="wide">
          <SheetTitle>Brand detail</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const wide = document.querySelector('[data-slot="sheet-content"]');
    expect(wide).toHaveAttribute("data-size", "wide");
    expect((wide as HTMLElement).className).toContain("overlay-wide");
    unmount();

    renderSheet(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const defaulted = document.querySelector('[data-slot="sheet-content"]');
    expect(defaulted).toHaveAttribute("data-size", "panel");
    expect((defaulted as HTMLElement).className).toContain("overlay-panel");
  });

  it("SheetTrigger is exported and renders a trigger", () => {
    expect(SheetTrigger).toBeTypeOf("function");

    renderSheet(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const trigger = screen.getByRole("button", { name: "Open filters" });
    expect(trigger).toHaveAttribute("data-slot", "sheet-trigger");
  });
});
