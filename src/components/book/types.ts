/** What a picker hands the booking page: one bookable choice. */
export type Selection = {
  startTime: string; // ISO
  endTime: string; // ISO
  units: number; // nights or days; 1 for a slot
  /** Full wording for the details step: bookingWhen. */
  when: string;
  /** Compact wording for the pay bar: bookingSpan. */
  short: string;
  /** price × units. */
  total: number;
};
