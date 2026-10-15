// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SubmitButton } from "@/components/ui/submit-button";
import { controlPress } from "@/lib/design/media-hover";

describe("SubmitButton", () => {
  it("is a full-width submit with no press scale (EL-06)", () => {
    render(
      <SubmitButton
        isSubmitting={false}
        idleLabel="Send"
        submittingLabel="Sending"
      />,
    );
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("w-full");
    expect(button).not.toHaveClass(controlPress);
  });
});
