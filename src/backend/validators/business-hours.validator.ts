import { z } from "zod";
import { timeValidator } from "./index.validator";

const dayEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: timeValidator("startTime").default("09:00"),
    endTime: timeValidator("endTime").default("17:00"),
    isClosed: z.boolean().default(false),
  })
  .strict()
  .refine((d) => d.isClosed || d.startTime < d.endTime, {
    message: "startTime must be earlier than endTime",
    path: ["startTime"],
  });

export const businessHoursValidatorSchema = z
  .object({
    days: z.array(dayEntrySchema).length(7, "must provide exactly 7 day entries"),
  })
  .strict()
  .refine((data) => new Set(data.days.map((d) => d.dayOfWeek)).size === 7, {
    message: "days must cover each of the 7 days of the week exactly once",
    path: ["days"],
  });

export type BusinessHoursValidatorSchema = z.infer<
  typeof businessHoursValidatorSchema
>;
