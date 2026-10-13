export type IsoDateRange = {
  start: string;
  end: string;
};

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
