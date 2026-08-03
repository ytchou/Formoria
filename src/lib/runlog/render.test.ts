import { describe, expect, it } from 'vitest'
import { enrichRunFixture } from './__fixtures__/enrich-run'
import { renderRunLogHtml } from './render'

describe('renderRunLogHtml', () => {
  it('renders the fixture to stable HTML', () => {
    expect(renderRunLogHtml(enrichRunFixture)).toMatchSnapshot()
  })

  it('escapes HTML in summaries', () => {
    const html = renderRunLogHtml({
      run: { id: 'job-escape', workflow: 'enrich', status: 'completed' },
      phases: [
        {
          name: 'detect',
          status: 'succeeded',
          events: [{ actor: 'SCRIPT', summary: '<script>alert(1)</script>', status: 'ok' }],
        },
      ],
    })

    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders a retry label on an audit event', () => {
    const html = renderRunLogHtml({
      run: { id: 'job-retry', workflow: 'enrich', status: 'completed' },
      phases: [
        {
          name: 'discover',
          status: 'succeeded',
          events: [
            {
              actor: 'HTTP',
              summary: 'brand search (network_error)',
              status: 'error',
              labels: { retry: '2' },
            },
          ],
        },
      ],
    })

    expect(html).toContain('retry 2')
  })

  it('never throws on garbage and renders gaps', () => {
    expect(renderRunLogHtml(null)).toContain('Data gaps')
  })

  it('renders a truncation row when eventsTruncated is set', () => {
    const html = renderRunLogHtml({
      run: { id: 'job-truncated', workflow: 'enrich', status: 'completed' },
      phases: [{ name: 'detect', status: 'succeeded', events: [], eventsTruncated: 312 }],
    })

    expect(html).toContain('312 more events omitted')
  })
})
