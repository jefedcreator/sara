export type Period = "today" | "week" | "month";

export type PeriodRange = {
  from: Date;
  to: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET = "+01:00";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parts(now: Date): { year: string; month: string; day: string } {
  const values = new Map(
    dayFormatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) {
    throw new Error("ASSISTANT_INVALID_DATE");
  }
  return { year, month, day };
}

/** The owner's business day, e.g. "2026-11-04", in Africa/Lagos. */
export function lagosDay(now: Date): string {
  const { year, month, day } = parts(now);
  return `${year}-${month}-${day}`;
}

function midnight(day: string): Date {
  return new Date(`${day}T00:00:00${LAGOS_OFFSET}`);
}

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Lagos calendar boundaries. Lagos has no daylight saving, so midnight is
 * always 00:00+01:00. Week starts Monday. `to` is exclusive.
 */
export function periodRange(period: Period, now: Date): PeriodRange {
  const day = lagosDay(now);
  const today = midnight(day);

  if (period === "today") {
    return { from: today, to: new Date(today.getTime() + DAY_MS) };
  }

  if (period === "week") {
    const weekday = utcDate(day).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = new Date(
      utcDate(day).getTime() - daysSinceMonday * DAY_MS,
    );
    const from = midnight(isoDay(monday));
    return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
  }

  const { year, month } = parts(now);
  const from = new Date(`${year}-${month}-01T00:00:00${LAGOS_OFFSET}`);
  const nextMonth = new Date(
    Date.UTC(Number(year), Number(month), 1),
  ).toISOString();
  const to = midnight(nextMonth.slice(0, 10));
  return { from, to };
}
