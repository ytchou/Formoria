// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "../form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

describe("FormField required wiring", () => {
  it("marks a required field's input aria-required", () => {
    render(
      <FormField id="x" label="L" required>
        <Input id="x" />
      </FormField>,
    );

    expect(screen.getByLabelText(/L/)).toHaveAttribute("aria-required", "true");
  });

  it("leaves an optional field's input without aria-required", () => {
    render(
      <FormField id="x" label="L">
        <Input id="x" />
      </FormField>,
    );

    expect(screen.getByLabelText(/L/)).not.toHaveAttribute("aria-required");
  });

  it("marks a required field's textarea aria-required", () => {
    render(
      <FormField id="t" label="T" required>
        <Textarea id="t" />
      </FormField>,
    );

    expect(screen.getByLabelText(/T/)).toHaveAttribute("aria-required", "true");
  });

  it("lets an explicit aria-required prop win over the field", () => {
    render(
      <FormField id="x" label="L" required>
        <Input id="x" aria-required={false} />
      </FormField>,
    );

    expect(screen.getByLabelText(/L/)).toHaveAttribute("aria-required", "false");
  });

  it("never adds the native required attribute", () => {
    render(
      <FormField id="x" label="L" required>
        <Input id="x" />
      </FormField>,
    );

    expect(screen.getByLabelText(/L/)).not.toHaveAttribute("required");
  });
});
