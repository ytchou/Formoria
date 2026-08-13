# Supabase API traffic investigation

Use this runbook to attribute a spike in Supabase API traffic to the Formoria
server, a build, a maintenance script, or an external caller. Supabase Logs
Explorer uses ClickHouse: every row is in `logs`, the API source is
`source = 'edge_logs'`, and structured fields are string-valued entries in the
`log_attributes` map. See the [Supabase logging field reference](https://supabase.com/docs/guides/telemetry/logs)
if a project exposes a different field set.

## Time windows

Record all times in UTC. Define two windows before querying:

1. **Build window:** from the deployment/build start through the successful
   `next build` completion, with a five-minute ingestion buffer on either side.
   Use the Railway deployment timestamps when the build log does not provide
   both boundaries. This is the window in which the old route could issue a
   whole-corpus read while generating concrete brand pages.
2. **Healthy post-deploy window:** from the first successful production health
   probe after deployment through the next 30 minutes. Compare it with an
   equally sized pre-deploy baseline and with the build window; do not mix
   build-time and request-time traffic in one total.

Prepend this ClickHouse CTE to each query below, replacing the timestamps with
the recorded window. The aliases are intentionally named `window_start` and
`window_end` so the query patterns can be copied without changing filters:

```sql
-- Replace with UTC timestamps recorded from Railway/deployment health checks.
WITH
  toDateTime('2026-08-13 00:00:00') AS window_start,
  toDateTime('2026-08-13 00:30:00') AS window_end

-- Follow with the SELECT from one of the patterns below.
```

## Field extraction

The current ClickHouse keys use the full dotted path and an underscore inside
header names:

```sql
SELECT
  timestamp,
  log_attributes['request.headers.x_real_ip'] AS caller_ip,
  log_attributes['request.headers.user_agent'] AS user_agent,
  log_attributes['request.headers.x_client_info'] AS x_client_info,
  log_attributes['request.method'] AS method,
  log_attributes['request.path'] AS path,
  toInt32OrZero(log_attributes['response.status_code']) AS status
FROM logs
WHERE source = 'edge_logs'
  AND timestamp >= window_start
  AND timestamp < window_end
ORDER BY timestamp DESC
LIMIT 100;
```

If a key appears empty, inspect the keys emitted by the project before drawing
conclusions:

```sql
SELECT
  arrayJoin(mapKeys(log_attributes)) AS key,
  count() AS rows
FROM logs
WHERE source = 'edge_logs'
  AND timestamp >= window_start
  AND timestamp < window_end
GROUP BY key
ORDER BY rows DESC
LIMIT 100;
```

## Traffic volume by minute

Start with a cheap minute-level view. It shows whether the spike is continuous
or clustered around the build.

```sql
SELECT
  toStartOfMinute(timestamp) AS minute,
  count() AS requests,
  countIf(startsWith(log_attributes['request.headers.user_agent'], 'FormoriaSupabase/1.0')) AS formoria_owned,
  countIf(NOT startsWith(log_attributes['request.headers.user_agent'], 'FormoriaSupabase/1.0')) AS external_or_untagged
FROM logs
WHERE source = 'edge_logs'
  AND timestamp >= window_start
  AND timestamp < window_end
GROUP BY minute
ORDER BY minute;
```

The ownership split is conservative: a Formoria prefix is evidence of a new
server-side client, while an empty or other User-Agent is reported as
external-or-untagged, not silently assigned to Formoria.

## Grouping dimensions

Use the same bounded window to identify the callers and route shape behind the
volume. Keep the dimensions together so a caller/IP/User-Agent cluster can be
reproduced from one result set.

```sql
SELECT
  toStartOfMinute(timestamp) AS minute,
  nullIf(log_attributes['request.headers.x_real_ip'], '') AS caller_ip,
  nullIf(log_attributes['request.headers.user_agent'], '') AS user_agent,
  nullIf(log_attributes['request.headers.x_client_info'], '') AS x_client_info,
  log_attributes['request.method'] AS method,
  log_attributes['request.path'] AS path,
  toInt32OrZero(log_attributes['response.status_code']) AS status,
  count() AS requests
FROM logs
WHERE source = 'edge_logs'
  AND timestamp >= window_start
  AND timestamp < window_end
GROUP BY minute, caller_ip, user_agent, x_client_info, method, path, status
ORDER BY requests DESC, minute ASC
LIMIT 500;
```

For a narrower ownership report, run the same query twice with these filters:

```sql
-- Formoria-owned server-side traffic
AND startsWith(log_attributes['request.headers.user_agent'], 'FormoriaSupabase/1.0')

-- External or historical untagged traffic
AND NOT startsWith(log_attributes['request.headers.user_agent'], 'FormoriaSupabase/1.0')
```

The `x-client-info` value is supplied by supabase-js and helps distinguish SDK
versions/runtime metadata; it is not an ownership proof. The new Formoria
User-Agent is the ownership attribution. For caller-IP analysis, treat the
value as operationally sensitive and limit access to the smallest incident
response group.

## Route and status rollups

Use this rollup to verify that the incident is API reads rather than writes or
auth/storage traffic. `request.path` commonly contains `/rest/v1/...`, while
the exact path depends on the Supabase service being called.

```sql
SELECT
  toStartOfMinute(timestamp) AS minute,
  log_attributes['request.method'] AS method,
  log_attributes['request.path'] AS path,
  toInt32OrZero(log_attributes['response.status_code']) AS status,
  count() AS requests
FROM logs
WHERE source = 'edge_logs'
  AND timestamp >= window_start
  AND timestamp < window_end
GROUP BY minute, method, path, status
ORDER BY requests DESC, minute ASC
LIMIT 500;
```

## Reporting template

Report these separately for the build and healthy post-deploy windows:

- total edge requests and peak requests/minute;
- Formoria-owned requests by User-Agent context (`build`, `runtime`,
  `development`, `test`, `script`);
- external-or-untagged requests by caller IP, User-Agent, method, path, and
  status;
- top `x-client-info` values and the route/status clusters associated with
  each;
- the pre-deploy baseline and the first 30-minute post-deploy comparison.

Historical evidence confirms that corpus-wide brand-detail prerendering was a
traffic amplifier: the old build emitted 1,590 concrete detail routes in the
available manifest, each capable of causing server-side Supabase reads. It
cannot prove that every one of the 249.9k observed entries was Formoria-owned;
historical requests without this attribution may be external, untagged, or
from another client. Preserve that uncertainty in the incident report.
