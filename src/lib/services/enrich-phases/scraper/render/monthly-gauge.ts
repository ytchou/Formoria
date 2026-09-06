import { auditedCall } from '@/lib/audit'

type MonthlyCountResult = { count: number | null; error: { message: string } | null }

/**
 * The count query, structurally. Typed here rather than against the generated
 * Supabase types because the service client is untyped (`createServiceClient`
 * takes no `<Database>` generic) and because the render layer is loaded by the
 * worker under plain `tsx`, where a fake client is the only way to test the
 * filter set.
 */
type MonthlyCountQuery = PromiseLike<MonthlyCountResult> & {
  eq(column: string, value: string): MonthlyCountQuery
  gte(column: string, value: string): MonthlyCountQuery
}

type RenderSpanCountClient = {
  from(table: 'external_call_audit'): {
    select(
      columns: string,
      options: { count: 'exact'; head: true },
    ): MonthlyCountQuery
  }
}

/**
 * Warn once per process. The gauge is read at most once per provider (the
 * budget wrapper caches it), but the worker builds a provider per run, so an
 * unreachable audit table would otherwise log on every job for as long as the
 * container lives.
 */
let warnedUnavailable = false

/**
 * First instant of the current UTC month, as an ISO timestamp.
 *
 * UTC, not local: `external_call_audit.created_at` is `timestamptz` written by
 * Postgres, and Browserless meters its free plan on calendar months. A local
 * month boundary on a UTC+8 host would under-count the first eight hours of
 * every month — the direction that spends renders we do not have.
 */
export function monthStartUtc(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString()
}

/**
 * How many Browserless renders this calendar month has already spent.
 *
 * Feeds `withRenderBudget`'s monthly gauge, which refuses at 900 against the
 * free plan's 1,000. `external_call_audit` is the only durable record of a
 * render: the worker is restarted freely and holds no counter across runs, so
 * an in-memory tally alone would reset the budget to zero on every deploy.
 *
 * Counts terminal `succeeded` spans only. A `started` row that never finished
 * did not consume a unit we can prove, and double-counting the pair would halve
 * the effective budget.
 *
 * FAILS OPEN: an unreachable audit table returns 0, so a Supabase incident
 * degrades into "the monthly cap is not enforced this run" rather than "no
 * brand can be rendered". The per-brand and per-job caps still hold, which
 * bounds the damage at one job's worth of renders. Upgrade path if the free
 * plan is ever actually exhausted this way: persist the running count with the
 * job and fail closed when neither source can be read.
 */
export async function loadBrowserlessMonthlyCount(
  supabase: unknown,
  now?: Date,
): Promise<number> {
  const monthStart = monthStartUtc(now)

  try {
    return await auditedCall(
      { provider: 'supabase', operation: 'countRenderSpans', kind: 'service' },
      async (ctx) => {
        ctx.summary.monthStart = monthStart
        const { count, error } = await (supabase as RenderSpanCountClient)
          .from('external_call_audit')
          .select('id', { count: 'exact', head: true })
          .eq('provider', 'browserless')
          .eq('operation', 'fetch_rendered')
          .eq('status', 'succeeded')
          .gte('created_at', monthStart)

        if (error) throw new Error(error.message)

        const total = count ?? 0
        ctx.summary.count = total
        return total
      },
    )
  } catch (error) {
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn(
        '[render-budget] monthly gauge unavailable, continuing at 0 —',
        error instanceof Error ? error.message : String(error),
      )
    }
    return 0
  }
}
