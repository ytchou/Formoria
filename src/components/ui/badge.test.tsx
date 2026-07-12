// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "./badge"

describe("Badge", () => {
  it("renders the verified variant with verified-green tokens", () => {
    render(<Badge variant="verified">已認證</Badge>)
    const badge = screen.getByText("已認證")
    expect(badge.className).toContain("bg-verified-green-bg")
    expect(badge.className).toContain("text-verified-green")
  })

  it("keeps default variant unchanged", () => {
    render(<Badge>tag</Badge>)
    expect(screen.getByText("tag").className).toContain("bg-primary")
  })
})
