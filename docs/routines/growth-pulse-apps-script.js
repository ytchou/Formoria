/**
 * Growth Pulse — GA4 Data Export to Google Sheets
 *
 * Writes five tabs from GA4 property 538232091:
 * Scorecard, Executive Summary, Daily Trend, Top Pages, Referral Sources.
 * All reporting ends at T-2 and excludes protected application routes.
 */

const GA4_PROPERTY_ID = '538232091';
const SHEET_ID = '1xL25wdLTw82hSIXf7UC51GAvQkSOXDAIohZeuhJSf0k';
const PROTECTED_PATH_PATTERN = '^/(?:zh-TW/|en/)?(?:admin|dashboard|auth)(?:/|$)';
const BRAND_PATH_PATTERN = '^/(?:zh-TW/|en/)?brands/[^/?]+(?:[/?]|$)';

function refreshGrowthPulseData() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  const timezone = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const timestamp = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss');
  const windows = getDateWindows(today);

  refreshScorecard(spreadsheet, windows, timestamp);
  refreshExecutiveSummary(spreadsheet, windows, timestamp);
  refreshDailyTrend(spreadsheet, windows, timestamp);
  refreshTopPages(spreadsheet, windows, timestamp);
  refreshReferralSources(spreadsheet, windows, timestamp);
}

function getDateWindows(today) {
  const latestCompleteDate = shiftIsoDate(today, -2);

  return {
    latestCompleteDate: latestCompleteDate,
    previousCompleteDate: shiftIsoDate(today, -3),
    sameWeekdayPreviousDate: shiftIsoDate(today, -9),
    current: {
      startDate: shiftIsoDate(today, -8),
      endDate: latestCompleteDate,
    },
    prior: {
      startDate: shiftIsoDate(today, -15),
      endDate: shiftIsoDate(today, -9),
    },
    trend: {
      startDate: shiftIsoDate(today, -29),
      endDate: latestCompleteDate,
    },
  };
}

function shiftIsoDate(isoDate, days) {
  const parts = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function refreshScorecard(spreadsheet, windows, timestamp) {
  const metrics = [
    { name: 'sessions' },
    { name: 'activeUsers' },
    { name: 'screenPageViews' },
    { name: 'bounceRate' },
    { name: 'averageSessionDuration' },
  ];
  const dates = [
    windows.latestCompleteDate,
    windows.previousCompleteDate,
    windows.sameWeekdayPreviousDate,
  ];
  const rows = dates.map(function (date) {
    const report = runPublicReport({
      dateRanges: [{ startDate: date, endDate: date }],
      metrics: metrics,
    });
    const values = firstMetricValues(report, metrics.length);
    return [date].concat(values);
  });

  writeSheet(
    spreadsheet,
    'Scorecard',
    ['date', 'sessions', 'activeUsers', 'screenPageViews', 'bounceRate', 'averageSessionDuration'],
    timestamp,
    rows,
  );
}

function refreshExecutiveSummary(spreadsheet, windows, timestamp) {
  const current = readExecutiveWindow(windows.current);
  const prior = readExecutiveWindow(windows.prior);
  const headers = [
    'latest_complete_date',
    'current_start',
    'current_end',
    'prior_start',
    'prior_end',
    'sessions_current',
    'sessions_prior',
    'users_current',
    'users_prior',
    'page_views_current',
    'page_views_prior',
    'brand_page_sessions_current',
    'brand_page_sessions_prior',
    'search_sessions_current',
    'search_sessions_prior',
    'search_events_current',
    'search_events_prior',
    'outbound_sessions_current',
    'outbound_sessions_prior',
    'outbound_events_current',
    'outbound_events_prior',
    'brand_page_rate_current',
    'search_rate_current',
    'outbound_rate_current',
  ];
  const row = [
    windows.latestCompleteDate,
    windows.current.startDate,
    windows.current.endDate,
    windows.prior.startDate,
    windows.prior.endDate,
    current.audience.sessions,
    prior.audience.sessions,
    current.audience.users,
    prior.audience.users,
    current.audience.pageViews,
    prior.audience.pageViews,
    current.brand.sessions,
    prior.brand.sessions,
    current.search.sessions,
    prior.search.sessions,
    current.search.events,
    prior.search.events,
    current.outbound.sessions,
    prior.outbound.sessions,
    current.outbound.events,
    prior.outbound.events,
    safeRate(current.brand.sessions, current.audience.sessions),
    safeRate(current.search.sessions, current.audience.sessions),
    safeRate(current.outbound.sessions, current.brand.sessions),
  ];

  writeSheet(spreadsheet, 'Executive Summary', headers, timestamp, [row]);
}

function readExecutiveWindow(window) {
  const audience = runPublicReport({
    dateRanges: [window],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
    ],
  });
  const brand = runPublicReport(
    {
      dateRanges: [window],
      metrics: [{ name: 'sessions' }],
    },
    pathIncludeFilter(BRAND_PATH_PATTERN),
  );
  const search = runPublicReport(
    {
      dateRanges: [window],
      metrics: [{ name: 'sessions' }, { name: 'eventCount' }],
    },
    exactFilter('eventName', 'search'),
  );
  const outbound = runPublicReport(
    {
      dateRanges: [window],
      metrics: [{ name: 'sessions' }, { name: 'eventCount' }],
    },
    exactFilter('eventName', 'external_link_clicked'),
  );
  const audienceValues = firstMetricValues(audience, 3);
  const brandValues = firstMetricValues(brand, 1);
  const searchValues = firstMetricValues(search, 2);
  const outboundValues = firstMetricValues(outbound, 2);

  return {
    audience: { sessions: audienceValues[0], users: audienceValues[1], pageViews: audienceValues[2] },
    brand: { sessions: brandValues[0] },
    search: { sessions: searchValues[0], events: searchValues[1] },
    outbound: { sessions: outboundValues[0], events: outboundValues[1] },
  };
}

function refreshDailyTrend(spreadsheet, windows, timestamp) {
  const audience = runPublicReport({
    dateRanges: [windows.trend],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });
  const brand = runPublicReport(
    {
      dateRanges: [windows.trend],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
    },
    pathIncludeFilter(BRAND_PATH_PATTERN),
  );
  const search = runPublicReport(
    {
      dateRanges: [windows.trend],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
    },
    exactFilter('eventName', 'search'),
  );
  const outbound = runPublicReport(
    {
      dateRanges: [windows.trend],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
    },
    exactFilter('eventName', 'external_link_clicked'),
  );
  const brandByDate = metricMap(brand, 1);
  const searchByDate = metricMap(search, 1);
  const outboundByDate = metricMap(outbound, 1);
  const audienceByDate = metricMap(audience, 3);
  const rows = enumerateIsoDates(windows.trend.startDate, windows.trend.endDate).map(function (date) {
    const values = audienceByDate[date] || [0, 0, 0];
    return [
      date,
      values[0],
      values[1],
      values[2],
      firstOrZero(brandByDate[date]),
      firstOrZero(searchByDate[date]),
      firstOrZero(outboundByDate[date]),
    ];
  });

  writeSheet(
    spreadsheet,
    'Daily Trend',
    ['date', 'sessions', 'activeUsers', 'screenPageViews', 'brandPageSessions', 'searchSessions', 'outboundSessions'],
    timestamp,
    rows,
  );
}

function enumerateIsoDates(startDate, endDate) {
  const dates = [];
  let date = startDate;
  while (date <= endDate) {
    dates.push(date);
    date = shiftIsoDate(date, 1);
  }
  return dates;
}

function refreshTopPages(spreadsheet, windows, timestamp) {
  const current = runPublicReport({
    dateRanges: [windows.current],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });
  const prior = runPublicReport({
    dateRanges: [windows.prior],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 50,
  });
  const priorMap = metricMap(prior, 2, false);
  const rows = (current.rows || []).map(function (row) {
    const path = row.dimensionValues[0].value;
    const values = row.metricValues.map(numberValue);
    const previous = priorMap[path] || [0, 0];
    return [path, values[0], values[1], previous[0], previous[1]];
  });

  writeSheet(
    spreadsheet,
    'Top Pages',
    ['pagePath', 'pageViews_current', 'users_current', 'pageViews_prev', 'users_prev'],
    timestamp,
    rows,
  );
}

function refreshReferralSources(spreadsheet, windows, timestamp) {
  const dimensions = [{ name: 'sessionSource' }, { name: 'sessionMedium' }];
  const current = runPublicReport({
    dateRanges: [windows.current],
    dimensions: dimensions,
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });
  const prior = runPublicReport({
    dateRanges: [windows.prior],
    dimensions: dimensions,
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 50,
  });
  const priorMap = metricMap(prior, 2, false, '/');
  const rows = (current.rows || []).map(function (row) {
    const source = row.dimensionValues[0].value;
    const medium = row.dimensionValues[1].value;
    const values = row.metricValues.map(numberValue);
    const previous = priorMap[source + '/' + medium] || [0, 0];
    return [source, medium, values[0], values[1], previous[0], previous[1]];
  });

  writeSheet(
    spreadsheet,
    'Referral Sources',
    ['sessionSource', 'sessionMedium', 'sessions_current', 'users_current', 'sessions_prev', 'users_prev'],
    timestamp,
    rows,
  );
}

function runPublicReport(request, additionalFilter) {
  const protectedFilter = {
    notExpression: pathIncludeFilter(PROTECTED_PATH_PATTERN),
  };
  const dimensionFilter = additionalFilter
    ? { andGroup: { expressions: [protectedFilter, additionalFilter] } }
    : protectedFilter;

  return AnalyticsData.Properties.runReport(
    Object.assign({}, request, { dimensionFilter: dimensionFilter }),
    'properties/' + GA4_PROPERTY_ID,
  );
}

function pathIncludeFilter(pattern) {
  return {
    filter: {
      fieldName: 'pagePath',
      stringFilter: { matchType: 'PARTIAL_REGEXP', value: pattern, caseSensitive: false },
    },
  };
}

function exactFilter(fieldName, value) {
  return {
    filter: {
      fieldName: fieldName,
      stringFilter: { matchType: 'EXACT', value: value, caseSensitive: true },
    },
  };
}

function firstMetricValues(report, count) {
  if (!report.rows || report.rows.length === 0) return Array(count).fill(0);
  return report.rows[0].metricValues.map(numberValue);
}

function metricMap(report, metricCount, normalizeDate, separator) {
  const result = {};
  (report.rows || []).forEach(function (row) {
    const parts = row.dimensionValues.map(function (value) { return value.value; });
    let key = parts.join(separator || '');
    if (normalizeDate !== false && /^\d{8}$/.test(key)) key = formatGaDate(key);
    result[key] = row.metricValues.slice(0, metricCount).map(numberValue);
  });
  return result;
}

function numberValue(value) {
  return Number(value.value) || 0;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function firstOrZero(values) {
  return values ? values[0] : 0;
}

function formatGaDate(value) {
  return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
}

function writeSheet(spreadsheet, name, headers, timestamp, rows) {
  const sheet = getOrCreateSheet(spreadsheet, name);
  const metadata = padRow(['last_updated', timestamp, 'property_id', GA4_PROPERTY_ID], headers.length);
  const values = [headers, metadata].concat(rows.map(function (row) {
    return padRow(row, headers.length);
  }));
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
}

function padRow(row, width) {
  return row.concat(Array(Math.max(0, width - row.length)).fill('')).slice(0, width);
}

function getOrCreateSheet(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'refreshGrowthPulseData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('refreshGrowthPulseData').timeBased().atHour(7).everyDays(1).create();
}
