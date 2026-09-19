import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('health-agent Railway configuration', () => {
  it('uses the shared GitHub App for clone authentication', () => {
    const server = readFileSync('src/health-agent/server.ts', 'utf8')

    expect(server).toContain("getInstallationToken('clone')")
    expect(server).not.toContain('process.env.GITHUB_TOKEN')
    expect(server).toContain('deadlineMs: 600_000')
    expect(server).toContain('pollIntervalMs: 5_000')
  })

  it('documents the GitHub App variables consumed by the shared adapter', () => {
    const envExample = readFileSync('.env.example', 'utf8')
    const railway = JSON.parse(
      readFileSync('railway/health-agent.json', 'utf8'),
    ) as { envVars: string[] }

    for (const name of [
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_INSTALLATION_ID',
    ]) {
      expect(envExample).toContain(`${name}=`)
      expect(railway.envVars).toContain(name)
    }
    expect(envExample).not.toContain('HEALTH_AGENT_GITHUB_APP_ID=')
  })
})
