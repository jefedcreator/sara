import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/server/db", () => ({ db: { booking: { findUnique: vi.fn(), update: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/backend/services/email", () => ({ emailService: {
  sendBookingCancellationEmail: vi.fn(), sendBookingRescheduledEmail: vi.fn(),
} }));
vi.mock("@/backend/services/googleCalendar", () => ({ googleCalendarService: { updateEvent: vi.fn(), deleteEvent: vi.fn() } }));

import { db } from "@/server/db";
import { emailService } from "@/backend/services/email";
import { googleCalendarService } from "@/backend/services/googleCalendar";
import { bookingMutations } from "./mutations";
import { addDays, todayIso } from "@/utils/format";

const start = new Date(`${addDays(todayIso(), 3)}T10:00:00Z`);
const newStart = new Date(`${addDays(todayIso(), 5)}T10:00:00Z`);
const service = { id: "s1", businessId: "biz_1", bookingMode: "SLOT", duration: 60, price: 10000,
  checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30, name: "Haircut", slug: "haircut" };
const existing = { id: "b1", slug: "b1", businessId: "biz_1", status: "CONFIRMED", startTime: start,
  endTime: new Date(start.getTime() + 3600000), units: 1, amount: 10000, service,
  clientEmail: "client@example.com", publicId: "public-booking", googleEventId: "event-1", business: { name: "Salon" } };
let booking: typeof existing;
let tx: { booking: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };
const client = () => tx as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.resetAllMocks();
  booking = { ...existing, service: { ...service } };
  tx = { booking: {
    findFirst: vi.fn().mockImplementation(async ({ where }) => where.slug ? booking : null),
    update: vi.fn().mockImplementation(async ({ data }) => ({ ...booking, ...data })),
  } };
});

describe("booking mutation core", () => {
  it("does not reschedule into another booking", async () => {
    tx.booking.findFirst.mockResolvedValueOnce(booking).mockResolvedValueOnce({ id: "b2" });
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { startTime: newStart })).rejects.toThrow("already booked");
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(tx.booking.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
      businessId: "biz_1", service: { bookingMode: "SLOT" }, id: { not: "b1" }, AND: expect.any(Array),
    }) }));
  });

  it("does not confirm an expired pending reservation over another booking", async () => {
    booking.status = "PENDING";
    tx.booking.findFirst.mockResolvedValueOnce(booking).mockResolvedValueOnce({ id: "b2" });
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { status: "CONFIRMED" })).rejects.toThrow("already booked");
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "CANCELLED"])("rejects transitions from terminal %s", async (status) => {
    booking.status = status;
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { status: "CONFIRMED" })).rejects.toThrow("Cannot transition");
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDING", "COMPLETED"],
    ["CONFIRMED", "PENDING"],
  ] as const)("rejects invalid %s to %s transitions", async (from, to) => {
    booking.status = from;
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { status: to })).rejects.toThrow("Cannot transition");
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "CANCELLED"])("rejects rescheduling a %s booking", async (status) => {
    booking.status = status;
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { startTime: newStart })).rejects.toThrow("Cannot reschedule");
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "CONFIRMED"] as const)("cancels %s and returns a post-commit effect", async (status) => {
    booking.status = status;
    const result = await bookingMutations.updateInTransaction(client(), "biz_1", "b1", { status: "CANCELLED" });
    expect(result.booking.status).toBe("CANCELLED");
    expect(result.effects).toEqual([{ kind: "booking_sync", id: "b1", previousStartTime: start.toISOString(), previousEndTime: existing.endTime.toISOString() }]);
    expect(emailService.sendBookingCancellationEmail).not.toHaveBeenCalled();
    expect(googleCalendarService.deleteEvent).not.toHaveBeenCalled();
    expect(db.booking.findUnique).not.toHaveBeenCalled();
  });

  it("scopes booking lookup and rejects foreign/missing bookings", async () => {
    tx.booking.findFirst.mockResolvedValueOnce(null);
    await expect(bookingMutations.updateInTransaction(client(), "foreign", "b1", { notes: "edit" })).rejects.toThrow("Booking not found");
    expect(tx.booking.findFirst).toHaveBeenCalledWith({ where: { slug: "b1", businessId: "foreign" }, include: { service: true } });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("rejects a foreign related service", async () => {
    booking.service.businessId = "foreign";
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { startTime: newStart })).rejects.toThrow("Booking not found");
  });

  it("validates slot duration instead of taking a supplied endTime", async () => {
    await expect(bookingMutations.updateInTransaction(client(), "biz_1", "b1", { startTime: newStart, endTime: new Date(newStart.getTime() + 60000) })).rejects.toThrow("does not match");
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it.each(["NIGHTLY", "DAILY"])("preserves booked units/amount and calculates %s endTime", async (mode) => {
    booking.units = 3;
    // Current service unit limits/prices must not change an existing reservation's terms.
    Object.assign(booking.service, { bookingMode: mode, minUnits: 5, price: 99999, checkInTime: "10:00", checkOutTime: "09:00" });
    const result = await bookingMutations.updateInTransaction(client(), "biz_1", "b1", { startTime: newStart, endTime: new Date(0) });
    const expected = new Date(`${addDays(todayIso(), 8)}T${mode === "NIGHTLY" ? "09" : "10"}:00:00Z`);
    expect(result.booking.endTime).toEqual(expected);
    expect(result.booking.units).toBe(3);
    expect(result.booking.amount).toBe(existing.amount);
    expect(tx.booking.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ serviceId: "s1" }) }));
    const data = tx.booking.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("amount");
    expect(data).not.toHaveProperty("units");
  });

  it("does not repeat notifications for detail edits on a cancelled booking", async () => {
    booking.status = "CANCELLED";
    const result = await bookingMutations.updateInTransaction(client(), "biz_1", "b1", { notes: "updated" });
    expect(result.effects).toEqual([]);
  });
});

describe("booking post-commit sync", () => {
  it("reloads the committed booking and preserves the original end in the reschedule email", async () => {
    const moved = { ...booking, startTime: newStart, endTime: new Date(newStart.getTime() + 3600000) };
    vi.mocked(db.booking.findUnique).mockResolvedValue(moved as never);
    await bookingMutations.finalize({ kind: "booking_sync", id: "b1", previousStartTime: start.toISOString(), previousEndTime: existing.endTime.toISOString() });
    expect(emailService.sendBookingRescheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      previousStartTime: start, previousSpan: expect.objectContaining({ endTime: existing.endTime }),
      span: expect.objectContaining({ endTime: moved.endTime }),
    }));
    expect(googleCalendarService.updateEvent).toHaveBeenCalledWith(moved.business, moved, moved.service);
  });

  it("only clears the event id after successful calendar deletion", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue({ ...booking, status: "CANCELLED" } as never);
    vi.mocked(googleCalendarService.deleteEvent).mockRejectedValue(new Error("offline"));
    await bookingMutations.finalize({ kind: "booking_sync", id: "b1" });
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("finalizes only after the serializable transaction has committed", async () => {
    let committed = false;
    vi.mocked(db.$transaction).mockImplementationOnce(async (work: any) => {
      const result = await work(client());
      expect(emailService.sendBookingCancellationEmail).not.toHaveBeenCalled();
      expect(googleCalendarService.deleteEvent).not.toHaveBeenCalled();
      committed = true;
      return result;
    });
    vi.mocked(db.booking.findUnique).mockImplementationOnce(() => {
      expect(committed).toBe(true);
      return Promise.resolve({ ...booking, status: "CANCELLED" }) as never;
    });
    await bookingMutations.update("biz_1", "b1", { status: "CANCELLED" });
    expect(emailService.sendBookingCancellationEmail).toHaveBeenCalledOnce();
    expect(googleCalendarService.deleteEvent).toHaveBeenCalledOnce();
  });
});
