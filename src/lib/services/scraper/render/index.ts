import { createHostedRenderProvider } from './hosted-provider'
import { createLocalPlaywrightProvider } from './local-playwright-provider'
import type { RenderProvider } from './types'

export function getRenderProvider(): RenderProvider {
  const apiKey = process.env.RENDER_API_KEY
  if (apiKey) {
    return createHostedRenderProvider(apiKey, {
      baseUrl: process.env.RENDER_API_BASE_URL,
    })
  }

  return createLocalPlaywrightProvider()
}
