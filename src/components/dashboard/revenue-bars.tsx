import type { DashboardData } from "types";

import { formatMoney } from "@/utils/format";

/**
 * Revenue per service as a ranked bar list. One series, so one hue (the
 * accent fill) and no legend; every bar carries its name and value as text,
 * because the fill alone is under 3:1 on white.
 */
export function RevenueBars({
  rows,
  currency,
}: {
  rows: DashboardData["revenueByService"];
  currency: string;
}) {
  const max = Math.max(...rows.map((r) => r.totalRevenue), 1);

  return (
    <ul className="grid gap-3.5">
      {rows.map((row) => {
        const share = Math.max(2, (row.totalRevenue / max) * 100);
        const bookings = `${row.totalBookings} booking${row.totalBookings === 1 ? "" : "s"}`;
        return (
          <li key={row.serviceId} title={`${row.serviceName}: ${formatMoney(row.totalRevenue, currency)} from ${bookings}`}>
            <div className="flex items-baseline justify-between gap-3 text-[15px]">
              <span className="min-w-0 truncate font-semibold">{row.serviceName}</span>
              <span className="text-ink-2 whitespace-nowrap">
                {formatMoney(row.totalRevenue, currency)}
                <span className="text-muted"> · {bookings}</span>
              </span>
            </div>
            {/* A native progress bar, so the width is data, not an inline style. */}
            <progress
              value={share}
              max={100}
              aria-hidden="true"
              className="bg-canvas mt-1.5 block h-2 w-full appearance-none overflow-hidden rounded-[4px] border-0 [&::-moz-progress-bar]:rounded-[4px] [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-canvas [&::-webkit-progress-value]:rounded-[4px] [&::-webkit-progress-value]:bg-accent"
            />
          </li>
        );
      })}
    </ul>
  );
}
