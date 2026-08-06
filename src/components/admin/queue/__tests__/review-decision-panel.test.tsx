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
