import type { ComponentProps, CSSProperties } from "react"

// Visually hidden without a `className`: this directory is not exempt from the
// no-raw-styled-control lint rule, and the field must not be routed through the
// styled <Input> primitive. The declarations below are Tailwind's `sr-only`
// verbatim, so the rendered result is unchanged.
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  borderWidth: 0,
}

type HoneypotFieldProps = {
  /** Must match the field name the server action reads. */
  name?: string
} & Omit<ComponentProps<"input">, "type" | "style" | "className">

/**
 * Anti-spam trap: a field no human ever sees or tabs into, so anything that
 * arrives filled came from a bot that blindly completed every input. The
 * server rejects those submissions.
 *
 * Four consumers, which is why this is a component and not four copies of an
 * per-site lint escape: the newsletter form passes nothing,
 * while the three submit forms spread a `react-hook-form` `register()` — hence
 * the passthrough props. They previously hid the field three different ways
 * (`sr-only`, and `absolute -left-[9999px] h-0 w-0 opacity-0`); one definition
 * now decides that for all of them.
 */
export function HoneypotField({ name = "website", ...props }: HoneypotFieldProps) {
  return (
    <input
      aria-hidden="true"
      autoComplete="off"
      name={name}
      style={SR_ONLY}
      tabIndex={-1}
      type="text"
      {...props}
    />
  )
}
