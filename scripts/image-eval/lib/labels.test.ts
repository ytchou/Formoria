import { describe, expect, it } from "vitest";
import { normalizeLabelInput, validateLabel } from "./labels";

describe("golden labels", () => {
  it("requires a semantic tag for every kept image", () => {
    const label = normalizeLabelInput({
      imageId: "image-1",
      disposition: "keep",
    });
    expect(validateLabel(label)).toContain("kept images require one valid tag");
  });

  it("requires at least one explicit reason for rejected images", () => {
    const label = normalizeLabelInput({
      imageId: "image-2",
      disposition: "reject",
    });
    expect(validateLabel(label)).toContain(
      "rejected images require at least one reason",
    );
  });

  it("normalizes a valid timeless logo label without promotion reasons", () => {
    const label = normalizeLabelInput({
      imageId: "image-3",
      disposition: "keep",
      tag: "logo",
    });
    expect(validateLabel(label)).toEqual([]);
    expect(label).toMatchObject({
      disposition: "keep",
      tag: "logo",
      reasons: [],
    });
  });
});
