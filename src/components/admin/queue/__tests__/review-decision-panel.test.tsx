// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewDecisionPanel } from "../review-decision-panel";

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ReviewDecisionPanel>> = {},
) {
  const onApprove = vi.fn();
  const onReject = vi.fn();

  render(
    <ReviewDecisionPanel
      onApprove={onApprove}
      onReject={onReject}
      {...overrides}
    />,
  );

  return { onApprove, onReject };
}

describe("ReviewDecisionPanel", () => {
  it("blocks reject with empty notes under requiredOnReject", () => {
    const { onReject } = renderPanel({ notesPolicy: "requiredOnReject" });

    const reject = screen.getByRole("button", { name: "Reject" });
    expect(reject).toBeDisabled();

    fireEvent.click(reject);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("states why reject is disabled instead of leaving a dead control", () => {
    renderPanel({ notesPolicy: "requiredOnReject" });

    const reject = screen.getByRole("button", { name: "Reject" });
    const hintId = reject.getAttribute("aria-describedby");
    expect(hintId).not.toBeNull();
    expect(document.getElementById(hintId as string)).toHaveTextContent(
      "required to reject",
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Not enough evidence" },
    });
    expect(reject).toBeEnabled();
    expect(reject).not.toHaveAttribute("aria-describedby");
  });

  it("allows approve with empty notes under requiredOnReject", () => {
    const { onApprove } = renderPanel({ notesPolicy: "requiredOnReject" });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith("");
  });

  it("renders no notes control when policy is none", () => {
    renderPanel({ notesPolicy: "none" });

    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("disables the primary action when the item is not eligible", () => {
    renderPanel({ eligible: false });

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled();
  });
});
