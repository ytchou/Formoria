import { describe, expect, it } from "vitest"
import { ESLint } from "eslint"

async function lintFixture(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: process.cwd() })
  const [result] = await eslint.lintText(code, { filePath })
  return result?.messages ?? []
}

describe("ui sourcing lint rules", () => {
  it("flags a raw styled button outside ui/", async () => {
    const messages = await lintFixture(
      'export function X(){return <button className="rounded-full px-4">x</button>}',
      "src/components/brands/__fixture__.tsx"
    )
    expect(
      messages.some(
        (m) => m.ruleId === "no-restricted-syntax" && /ui\//.test(m.message)
      )
    ).toBe(true)
  })

  it("is silenced by a ui-exception disable directive", async () => {
    const messages = await lintFixture(
      `export function X(){return (
        // eslint-disable-next-line no-restricted-syntax -- ui-exception: test fixture
        <button className="rounded-full px-4">x</button>
      )}`,
      "src/components/brands/__fixture__.tsx"
    )
    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(false)
  })

  it("does not flag ui/ primitives themselves", async () => {
    const messages = await lintFixture(
      'export function X(){return <button className="h-8">x</button>}',
      "src/components/ui/__fixture__.tsx"
    )
    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(false)
  })
})
