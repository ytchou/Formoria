import { createLocalPlaywrightProvider } from './local-playwright-provider'
import type { RenderProvider } from './types'

export function getRenderProvider(): RenderProvider {
  return createLocalPlaywrightProvider()
}
