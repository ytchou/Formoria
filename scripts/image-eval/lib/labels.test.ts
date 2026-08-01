import { describe, expect, it } from "vitest";
import {
  appendLabelRevision,
  normalizeLabelInput,
  validateLabel,
} from "./labels";

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
      observationTags: [],
      reasons: [],
    });
  });

  it("keeps workspace as a non-scored observation tag", () => {
    const label = normalizeLabelInput({
      imageId: "image-4",
      disposition: "keep",
      tag: "lifestyle",
      observationTags: ["workspace", "workspace"],
    });
    expect(validateLabel(label)).toEqual([]);
    expect(label.observationTags).toEqual(["workspace"]);
  });

  it("seeds and appends label history without losing the prior revision", () => {
    const first = normalizeLabelInput({
      imageId: "image-5",
      disposition: "keep",
      tag: "lifestyle",
    });
    const second = normalizeLabelInput({
      imageId: "image-5",
      disposition: "reject",
      reasons: ["low_visual_quality"],
    });
    const labelsFile = appendLabelRevision(
      {
        schemaVersion: 1,
        corpusId: "corpus-1",
        labels: { [first.imageId]: first },
      },
      second,
    );
    expect(labelsFile.labels[first.imageId]).toEqual(second);
    expect(labelsFile.history?.[first.imageId]).toEqual([
      { revision: 1, label: first },
      { revision: 2, label: second },
    ]);
  });
});
