import { coerceRunLog } from './normalize'
import type { Phase, StepEvent, SummaryChip } from './schema'

export type RenderOptions = {
  title?: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return Math.round(value).toLocaleString('en-US')
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s`
  const minutes = Math.floor(value / 60_000)
  return `${minutes}m ${Math.round((value % 60_000) / 1_000)}s`
}

function formatTimestamp(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(11, 19)
}

function renderChip(chip: SummaryChip): string {
  return `<div class="chip chip-${chip.tone ?? 'neutral'}"><span>${escapeHtml(chip.label)}</span><strong>${escapeHtml(chip.value)}</strong></div>`
}

function eventMetrics(event: StepEvent): string {
  const metrics: string[] = []
  if (event.tokens) {
    const input = event.tokens.input ?? 0
    const output = event.tokens.output ?? 0
    metrics.push(`${formatNumber(input)}→${formatNumber(output)} tok`)
  }
  if (event.latencyMs !== undefined) metrics.push(formatDuration(event.latencyMs))
  return metrics.join(' · ') || '—'
}

function renderEvent(event: StepEvent): string {
  const target = event.labels?.target ? `<span class="target">${escapeHtml(event.labels.target)}</span>` : ''
  const model = event.model ? `<span class="model">${escapeHtml(event.model)}</span>` : ''
  const error = event.error ? `<div class="event-error">${escapeHtml(event.error)}</div>` : ''

  return `<tr class="event event-${event.status}">
    <td class="time">${escapeHtml(formatTimestamp(event.timestamp))}</td>
    <td><span class="actor actor-${event.actor.toLowerCase()}">${escapeHtml(event.actor)}</span></td>
    <td><div class="event-summary">${target}<span>${escapeHtml(event.summary)}</span>${model}</div>${error}</td>
    <td class="metrics">${escapeHtml(eventMetrics(event))}</td>
  </tr>`
}

function renderPhase(phase: Phase): string {
  const eventCount = phase.events.length + (phase.eventsTruncated ?? 0)
  const duration = phase.durationMs === undefined ? 'duration unavailable' : formatDuration(phase.durationMs)
  const events = phase.events.map(renderEvent).join('\n')
  const truncated = phase.eventsTruncated
    ? `<tr class="truncated"><td colspan="4">${formatNumber(phase.eventsTruncated)} more events omitted</td></tr>`
    : ''

  return `<details class="phase phase-${phase.status}" open>
    <summary>
      <span class="phase-index">${String(phase.index).padStart(2, '0')}</span>
      <span class="phase-main"><span class="phase-title">${escapeHtml(phase.name)}</span><span class="kind">${escapeHtml(phase.kind)}</span><span class="status-dot" aria-label="${escapeHtml(phase.status)}"></span><span class="phase-copy">${escapeHtml(phase.summary ?? '')}</span></span>
      <span class="phase-meta">${formatNumber(eventCount)} events · ${escapeHtml(duration)}</span>
    </summary>
    <div class="event-wrap">
      <table><thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Usage / latency</th></tr></thead><tbody>${events}${truncated}</tbody></table>
    </div>
  </details>`
}

export function renderRunLogHtml(input: unknown, options: RenderOptions = {}): string {
  const runlog = coerceRunLog(input)
  const title = options.title ?? `${runlog.run.workflow} run log`
  const summaryChips: SummaryChip[] = [
    ...(runlog.summary.durationMs === undefined
      ? []
      : [{ label: 'Duration', value: formatDuration(runlog.summary.durationMs) }]),
    { label: 'Phases', value: String(runlog.summary.phaseCount) },
    ...(runlog.summary.callCount === undefined ? [] : [{ label: 'LLM calls', value: formatNumber(runlog.summary.callCount) }]),
    ...(runlog.summary.queryCount === undefined
      ? []
      : [{ label: 'Queries', value: formatNumber(runlog.summary.queryCount) }]),
    ...(runlog.summary.tokens?.total === undefined
      ? []
      : [{ label: 'Tokens', value: formatNumber(runlog.summary.tokens.total) }]),
    ...Object.entries(runlog.summary.outcomes ?? {}).map(([label, value]) => ({ label, value: formatNumber(value) })),
    ...(runlog.summary.extraChips ?? []),
  ]
  const barPhases = runlog.phases.filter((phase) => (phase.barWeight ?? phase.durationMs ?? 0) > 0)
  const phaseBar = barPhases.length
    ? `<div class="phase-bar" aria-label="Phase durations">${barPhases
        .map(
          (phase) =>
            `<span class="bar-${phase.status}" style="flex-grow:${phase.barWeight ?? phase.durationMs}" title="${escapeHtml(`${phase.name}: ${formatDuration(phase.durationMs ?? 0)}`)}"></span>`,
        )
        .join('')}</div>`
    : ''
  const components = (runlog.provenance.components ?? [])
    .map((component) => `${component.name}${component.version ? ` @ ${component.version}` : ''}`)
    .join(' · ')
  const gaps = runlog.gaps?.length
    ? `<section class="gaps"><h2>Data gaps</h2><ul>${runlog.gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul></section>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--panel:#fff;--panel-2:#f1f3f5;--text:#17202a;--muted:#65717d;--line:#dce1e6;--ok:#1f8a58;--warn:#a16600;--error:#c5383f;--running:#2878c8;--accent:#7656d6;--shadow:0 12px 36px rgba(18,28,38,.08)}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--panel:#151b23;--panel-2:#1c2430;--text:#e8edf2;--muted:#9aa7b4;--line:#303a46;--ok:#46c486;--warn:#e7ae48;--error:#f06a70;--running:#65a9ed;--accent:#a68af0;--shadow:0 16px 42px rgba(0,0,0,.28)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(1180px,calc(100% - 32px));margin:32px auto 64px}.hero{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}.eyebrow{margin:0 0 6px;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}h1{margin:0;font-size:clamp(24px,4vw,38px);line-height:1.15}.run-meta{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:14px;color:var(--muted)}code,.time,.metrics,.phase-index{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.badge{display:inline-flex;align-items:center;min-height:28px;padding:2px 10px;border:1px solid currentColor;border-radius:999px;font-weight:700}.status-completed{color:var(--ok)}.status-failed{color:var(--error)}.status-running{color:var(--running)}.status-cancelled,.status-unknown,.status-queued{color:var(--muted)}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.chip{display:flex;gap:8px;align-items:baseline;padding:8px 11px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2)}.chip span{color:var(--muted);font-size:12px}.chip strong{font-variant-numeric:tabular-nums}.chip-success{border-color:var(--ok)}.chip-warning{border-color:var(--warn)}.chip-danger{border-color:var(--error)}.phase-bar{display:flex;height:10px;gap:2px;overflow:hidden;border-radius:999px;background:var(--panel-2)}.phase-bar span{min-width:3px}.bar-succeeded{background:var(--ok)}.bar-failed{background:var(--error)}.bar-running{background:var(--running)}.bar-skipped,.bar-pending,.bar-unknown{background:var(--muted)}.phases{display:grid;gap:10px;margin-top:18px}.phase{overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--panel)}summary{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;min-height:64px;padding:8px 16px 8px 8px;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}summary:focus-visible{outline:3px solid var(--running);outline-offset:-3px}.phase-index{color:var(--muted);font-size:16px;text-align:center}.phase-main{display:flex;align-items:center;gap:9px;min-width:0}.phase-title{font-size:16px;font-weight:750}.kind,.model,.target{display:inline-flex;padding:2px 7px;border-radius:6px;background:var(--panel-2);color:var(--muted);font-size:11px}.status-dot{width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:var(--muted)}.phase-succeeded .status-dot{background:var(--ok)}.phase-failed .status-dot{background:var(--error)}.phase-running .status-dot{background:var(--running)}.phase-copy{overflow:hidden;color:var(--muted);text-overflow:ellipsis;white-space:nowrap}.phase-meta{padding-left:16px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}.event-wrap{overflow-x:auto;border-top:1px solid var(--line)}table{width:100%;border-collapse:collapse;min-width:720px}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--panel-2);color:var(--muted);font-size:11px;letter-spacing:.05em;text-transform:uppercase}tbody tr:last-child td{border-bottom:0}.time{width:88px;color:var(--muted)}.actor{display:inline-flex;width:72px;justify-content:center;padding:3px 7px;border-radius:6px;background:var(--panel-2);font:700 11px ui-monospace,SFMono-Regular,Consolas,monospace}.actor-llm{color:var(--accent)}.actor-http,.actor-scrape{color:var(--running)}.actor-db,.actor-storage{color:var(--ok)}.event-summary{display:flex;align-items:center;flex-wrap:wrap;gap:7px}.event-error{margin-top:5px;color:var(--error)}.event-error td{background:color-mix(in srgb,var(--error) 6%,transparent)}.metrics{text-align:right;white-space:nowrap}.truncated td{text-align:center;color:var(--muted);font-style:italic}.gaps{margin-top:18px;padding:16px 20px;border:1px solid color-mix(in srgb,var(--warn) 55%,var(--line));border-radius:12px;background:var(--panel)}.gaps h2{margin:0 0 6px;font-size:14px}.gaps ul{margin:0;padding-left:20px;color:var(--muted)}footer{margin-top:18px;padding:0 4px;color:var(--muted);font-size:12px}footer p{margin:3px 0}@media(max-width:720px){main{width:min(100% - 20px,1180px);margin-top:10px}.hero{padding:18px}summary{grid-template-columns:42px 1fr}.phase-main{flex-wrap:wrap}.phase-copy{order:2;flex-basis:100%}.phase-meta{grid-column:2;padding:0 0 6px}.chips{margin-bottom:14px}}
</style>
</head>
<body><main>
  <header class="hero">
    <p class="eyebrow">Workflow execution</p>
    <h1>${escapeHtml(title)}</h1>
    <div class="run-meta"><code>${escapeHtml(runlog.run.id)}</code><span>${escapeHtml(runlog.run.actor ?? 'unknown actor')}</span><span>${escapeHtml(runlog.run.startedAt ?? runlog.provenance.generatedAt)}</span><span class="badge status-${runlog.run.status}">${escapeHtml(runlog.run.status)}</span></div>
    <div class="chips">${summaryChips.map(renderChip).join('')}</div>
    ${phaseBar}
  </header>
  <section class="phases">${runlog.phases.map(renderPhase).join('\n')}</section>
  ${gaps}
  <footer><p>${escapeHtml(components || runlog.provenance.producer.name)}</p><p>Source: ${escapeHtml(runlog.provenance.sourceRef ?? runlog.run.id)} · Generated: ${escapeHtml(runlog.provenance.generatedAt)} · Schema: ${escapeHtml(runlog.schemaVersion)}</p></footer>
</main></body></html>`
}
