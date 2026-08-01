import { describe, expect, it } from "vitest";
import {
  appendLabelRevision,
  hydrateLabelsFile,
  normalizeLabelInput,
  registerTagDefinition,
  validateLabel,
} from "./labels";

describe("golden labels", () => {
  it("requires a semantic tag for every kept image", () => {
    const label = normalizeLabelInput({
      imageId: "image-1",
      disposition: "keep",
    });
    expect(validateLabel(label)).toContain(
      "kept images require one registered primary tag",
    );
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

  it("registers a dynamic primary tag and validates labels against it", () => {
    const registered = registerTagDefinition(
      {
        schemaVersion: 1,
        corpusId: "corpus-1",
        labels: {},
      },
      {
        slug: "[WORKSPACE]",
        label: "Workspace / studio",
        description: "Brand workshop, studio, or working environment.",
        createdFromImageId: "image-4",
      },
    );
    const label = normalizeLabelInput({
      imageId: "image-4",
      disposition: "keep",
      tag: registered.tag.slug,
    });
    expect(registered.tag.slug).toBe("workspace");
    expect(validateLabel(label, registered.labelsFile.tagDefinitions)).toEqual(
      [],
    );
  });

  it("hydrates legacy labels with system tags and revision-one history", () => {
    const label = normalizeLabelInput({
      imageId: "image-legacy",
      disposition: "keep",
      tag: "product",
    });
    const hydrated = hydrateLabelsFile({
      schemaVersion: 1,
      corpusId: "corpus-1",
      labels: { [label.imageId]: label },
    });
    expect(Object.keys(hydrated.tagDefinitions ?? {})).toEqual([
      "product",
      "lifestyle",
      "packaging",
      "logo",
    ]);
    expect(hydrated.history?.[label.imageId]).toEqual([{ revision: 1, label }]);
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
