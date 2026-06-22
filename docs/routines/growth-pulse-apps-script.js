/**
 * Growth Pulse — GA4 Data Export to Google Sheets
 *
 * Queries GA4 property 538232091 daily and writes results to 3 tabs:
 *   Scorecard, Top Pages, Referral Sources
 *
 * Setup (standalone script):
 *   1. Go to https://script.google.com → New project
 *   2. Paste this code into Code.gs
 *   3. In the left sidebar: Services (+) → Google Analytics Data API → Add
 *   4. Run refreshGrowthPulseData() manually to test (authorize when prompted)
 *   5. Run setupDailyTrigger() once to schedule daily 7 AM refresh
 */

const GA4_PROPERTY_ID = '538232091';
const SHEET_ID = '1xL25wdLTw82hSIXf7UC51GAvQkSOXDAIohZeuhJSf0k';

function refreshGrowthPulseData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tz = Session.getScriptTimeZone();
  const now = new Date();

  const yesterday = daysAgo(1);
  const twoDaysAgo = daysAgo(2);
  const eightDaysAgo = daysAgo(8);

  const fmt = (d) => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const timestamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss');

  refreshScorecard(ss, fmt(yesterday), fmt(twoDaysAgo), fmt(eightDaysAgo), timestamp);
  refreshTopPages(ss, fmt(yesterday), fmt(eightDaysAgo), timestamp);
  refreshReferralSources(ss, fmt(yesterday), fmt(eightDaysAgo), timestamp);
}

function refreshScorecard(ss, yesterday, twoDaysAgo, eightDaysAgo, timestamp) {
  const sheet = getOrCreateSheet(ss, 'Scorecard');
  const metrics = [
    { name: 'sessions' },
    { name: 'activeUsers' },
    { name: 'screenPageViews' },
    { name: 'bounceRate' },
    { name: 'averageSessionDuration' },
  ];

  const dates = [yesterday, twoDaysAgo, eightDaysAgo];
  const rows = dates.map((date) => {
    const report = runReport({
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: 'date' }],
      metrics: metrics,
    });
    const row = report.rows && report.rows.length > 0 ? report.rows[0] : null;
    if (!row) return [date, 0, 0, 0, 0, 0];
    return [
      date,
      ...row.metricValues.map((v) => parseFloat(v.value) || 0),
    ];
  });

  sheet.clear();
  sheet.appendRow(['date', 'sessions', 'activeUsers', 'screenPageViews', 'bounceRate', 'averageSessionDuration']);
  sheet.appendRow(['last_updated', timestamp, 'property_id', GA4_PROPERTY_ID]);
  rows.forEach((row) => sheet.appendRow(row));
}

function refreshTopPages(ss, yesterday, eightDaysAgo, timestamp) {
  const sheet = getOrCreateSheet(ss, 'Top Pages');

  const currentReport = runReport({
    dateRanges: [{ startDate: yesterday, endDate: yesterday }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });

  const prevReport = runReport({
    dateRanges: [{ startDate: eightDaysAgo, endDate: eightDaysAgo }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });

  const prevMap = {};
  if (prevReport.rows) {
    prevReport.rows.forEach((row) => {
      const path = row.dimensionValues[0].value;
      prevMap[path] = row.metricValues.map((v) => parseFloat(v.value) || 0);
    });
  }

  sheet.clear();
  sheet.appendRow(['pagePath', 'pageViews_current', 'users_current', 'pageViews_prev', 'users_prev']);
  sheet.appendRow(['last_updated', timestamp, 'property_id', GA4_PROPERTY_ID]);

  if (currentReport.rows) {
    currentReport.rows.forEach((row) => {
      const path = row.dimensionValues[0].value;
      const current = row.metricValues.map((v) => parseFloat(v.value) || 0);
      const prev = prevMap[path] || [0, 0];
      sheet.appendRow([path, current[0], current[1], prev[0], prev[1]]);
    });
  }
}

function refreshReferralSources(ss, yesterday, eightDaysAgo, timestamp) {
  const sheet = getOrCreateSheet(ss, 'Referral Sources');

  const currentReport = runReport({
    dateRanges: [{ startDate: yesterday, endDate: yesterday }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });

  const prevReport = runReport({
    dateRanges: [{ startDate: eightDaysAgo, endDate: eightDaysAgo }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });

  const prevMap = {};
  if (prevReport.rows) {
    prevReport.rows.forEach((row) => {
      const key = row.dimensionValues[0].value + '/' + row.dimensionValues[1].value;
      prevMap[key] = row.metricValues.map((v) => parseFloat(v.value) || 0);
    });
  }

  sheet.clear();
  sheet.appendRow(['sessionSource', 'sessionMedium', 'sessions_current', 'users_current', 'sessions_prev', 'users_prev']);
  sheet.appendRow(['last_updated', timestamp, 'property_id', GA4_PROPERTY_ID]);

  if (currentReport.rows) {
    currentReport.rows.forEach((row) => {
      const source = row.dimensionValues[0].value;
      const medium = row.dimensionValues[1].value;
      const current = row.metricValues.map((v) => parseFloat(v.value) || 0);
      const prev = prevMap[source + '/' + medium] || [0, 0];
      sheet.appendRow([source, medium, current[0], current[1], prev[0], prev[1]]);
    });
  }
}

function runReport(request) {
  return AnalyticsData.Properties.runReport(request, 'properties/' + GA4_PROPERTY_ID);
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'refreshGrowthPulseData') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('refreshGrowthPulseData')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();

  Logger.log('Daily trigger set for ~7:00 AM in timezone: ' + Session.getScriptTimeZone());
}
