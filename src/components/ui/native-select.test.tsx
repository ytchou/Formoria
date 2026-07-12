// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NativeSelect } from "./native-select"

describe("NativeSelect", () => {
  it("renders a real native select and passes props through", () => {
    const onChange = vi.fn()
    render(
      <NativeSelect id="sort" value="newest" onChange={onChange}>
        <option value="newest">最新</option>
        <option value="name">名稱</option>
      </NativeSelect>
    )
    const select = screen.getByRole("combobox")
    expect(select.tagName).toBe("SELECT")
    expect(select).toHaveAttribute("id", "sort")
    fireEvent.change(select, { target: { value: "name" } })
    expect(onChange).toHaveBeenCalled()
  })

  it("merges className with base styling", () => {
    render(
      <NativeSelect className="w-full" aria-label="sort">
        <option>a</option>
      </NativeSelect>
    )
    const select = screen.getByRole("combobox")
    expect(select.className).toContain("w-full")
    expect(select.className).toContain("rounded-lg")
  })
})
