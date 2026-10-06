import { withMiddleware } from "@/backend/middleware";
import { emailService } from "@/backend/services/email";
import { env } from "@/env";
import { db } from "@/server/db";
import {
  InternalServerErrorException,
  UnauthorizedException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @description Dispatches the 24-hours-ahead reminder email for CONFIRMED
 *              bookings. Guarded by a shared secret (`CRON_SECRET`) rather
 *              than user auth — there is no user in a cron request. A
 *              booking's reminder fires the first time this route runs
 *              after its startTime falls within the next 24 hours;
 *              `reminderSentAt` makes each booking eligible exactly once,
 *              regardless of whether the email send itself succeeds.
 * @auth none — Authorization: Bearer <CRON_SECRET>
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      if (!env.CRON_SECRET) {
        throw new InternalServerErrorException(
          "CRON_SECRET is not configured",
        );
      }

      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
        throw new UnauthorizedException("Invalid or missing cron secret");
      }

      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const dueBookings = await db.booking.findMany({
        where: {
          status: "CONFIRMED",
          reminderSentAt: null,
          startTime: { gte: now, lte: in24h },
        },
        include: {
          business: {
            select: { name: true, email: true, address: true, city: true, state: true },
          },
          service: { select: { name: true, bookingMode: true } },
        },
      });

      const results = await Promise.all(
        dueBookings.map(async (booking) => {
          let emailStatus: "sent" | "failed" | "skipped" = "skipped";
          if (booking.clientEmail) {
            const result = await emailService.sendBookingReminderEmail({
              to: booking.clientEmail,
              business: booking.business,
              serviceName: booking.service.name,
              startTime: booking.startTime,
              span: {
                bookingMode: booking.service.bookingMode,
                endTime: booking.endTime,
                units: booking.units,
              },
            });
            emailStatus = result.success ? "sent" : "failed";
          }

          await db.booking.update({
            where: { id: booking.id },
            data: { reminderSentAt: now },
          });

          return emailStatus;
        }),
      );

      const sent = results.filter((r) => r === "sent").length;
      const failed = results.filter((r) => r === "failed").length;

      const response: ApiResponse<{
        checked: number;
        sent: number;
        failed: number;
      }> = {
        status: 200,
        message: "Reminder dispatch complete",
        data: { checked: dueBookings.length, sent, failed },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while dispatching reminders: ${error.message}`,
      );
    }
  },
  [],
);
