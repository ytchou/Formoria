export type IsoDateRange = {
  start: string;
  end: string;
};

/** Analytics windows are Taipei-based (see posthog-owner-analytics). */
export const ANALYTICS_TIME_ZONE = "Asia/Taipei";

export function dateRangeForPastDays(
  days: number,
  now = new Date(),
): IsoDateRange {
  // Always resolve in Asia/Taipei: this runs in a 'use client' component, so a
  // runtime-local calculation makes the UTC server and a UTC+8 browser render
  // different strings (hydration mismatch) and disagree with the query window.
  const today = isoDateInTimeZone(now.toISOString(), ANALYTICS_TIME_ZONE);

  return {
    start: shiftIsoDate(today, -days),
    end: shiftIsoDate(today, -1),
  };
}

export function isDateInRange(date: string, range: IsoDateRange | null) {
  return !range || (date >= range.start && date <= range.end);
}

export function isoDateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = partValue("year");
  const month = partValue("month");
  const day = partValue("day");

  if (!year || !month || !day) {
    throw new RangeError(`Unable to format date in ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function formatIsoDate(date: string, locale: string, showYear: boolean) {
  return new Intl.DateTimeFormat(locale, {
    year: showYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function shiftIsoDate(isoDate: string, days: number) {
  const shifted = new Date(`${isoDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted.toISOString().slice(0, 10);
}
