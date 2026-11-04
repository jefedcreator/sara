import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { serviceService } from "./index";

vi.mock("@/server/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/backend/services/cloudinary", () => ({ cloudinaryService: { uploadFile: vi.fn() } }));
import { cloudinaryService } from "@/backend/services/cloudinary";
import { db } from "@/server/db";

const input = { name: "Haircut", price: 10000, duration: 60, availableFrom: "08:00", availableTo: "17:00", isActive: true,
  bookingMode: "SLOT" as const, minUnits: 1, maxUnits: 30 };
const existing = { ...input, id: "s1", slug: "haircut", businessId: "biz_1", image: "old-photo",
  checkInTime: null, checkOutTime: null, business: { name: "Salon" } };
let service: typeof existing;
let tx: { business: { findUnique: ReturnType<typeof vi.fn> }; service: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }; booking: { count: ReturnType<typeof vi.fn> } };
const client = () => tx as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.resetAllMocks();
  service = { ...existing };
  tx = {
    business: { findUnique: vi.fn().mockResolvedValue({ id: "biz_1" }) },
    service: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => where.slug ? service : null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: "s2", ...data })),
      update: vi.fn().mockImplementation(async ({ data }) => ({ ...service, ...data })),
    }, booking: { count: vi.fn().mockResolvedValue(0) },
  };
});

describe("service mutations", () => {
  it("creates with an explicit persisted image URL and no remote effects", async () => {
    const result = await serviceService.createInTransaction(client(), "biz_1", input, "https://images.example/service.jpg");
    expect(result.image).toBe("https://images.example/service.jpg");
    expect(tx.service.create).toHaveBeenCalledWith({ data: expect.objectContaining({ business: { connect: { id: "biz_1" } }, slug: "haircut" }) });
    expect(cloudinaryService.uploadFile).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a missing business using the supplied client", async () => {
    tx.business.findUnique.mockResolvedValueOnce(null);
    await expect(serviceService.createInTransaction(client(), "foreign", input, null)).rejects.toThrow("Business not found");
    expect(tx.service.create).not.toHaveBeenCalled();
  });

  it("rejects foreign/missing service updates", async () => {
    tx.service.findFirst.mockResolvedValueOnce(null);
    await expect(serviceService.updateInTransaction(client(), "foreign", "haircut", { price: 20 })).rejects.toThrow("Service not found");
    expect(tx.service.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "haircut", businessId: "foreign" } }));
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it("pauses without deleting the service or changing existing booking terms", async () => {
    const result = await serviceService.updateInTransaction(client(), "biz_1", "haircut", { isActive: false });
    expect(result.isActive).toBe(false);
    expect(tx.booking.count).not.toHaveBeenCalled();
    expect(tx.service.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { isActive: false, checkInTime: null, checkOutTime: null } });
  });

  it("rejects create name conflicts within the business", async () => {
    tx.service.findFirst.mockResolvedValueOnce({ id: "existing-name" });
    await expect(serviceService.createInTransaction(client(), "biz_1", input, null)).rejects.toThrow("name already exists");
    expect(tx.service.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz_1", name: { equals: "Haircut", mode: "insensitive" } } }));
    expect(tx.service.create).not.toHaveBeenCalled();
  });

  it("rejects rename conflicts while excluding the service itself", async () => {
    tx.service.findFirst.mockResolvedValueOnce(service).mockResolvedValueOnce({ id: "other" });
    await expect(serviceService.updateInTransaction(client(), "biz_1", "haircut", { name: "Other" })).rejects.toThrow("name already exists");
    expect(tx.service.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: "s1" } }) }));
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it("checks active upcoming bookings in the transaction before changing booking mode", async () => {
    tx.booking.count.mockResolvedValueOnce(1);
    await expect(serviceService.updateInTransaction(client(), "biz_1", "haircut", { bookingMode: "DAILY" })).rejects.toThrow("upcoming bookings");
    expect(tx.booking.count).toHaveBeenCalledWith({ where: expect.objectContaining({ businessId: "biz_1", serviceId: "s1", AND: expect.any(Array) }) });
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it("validates merged nightly setup and unit bounds", async () => {
    await expect(serviceService.updateInTransaction(client(), "biz_1", "haircut", { bookingMode: "NIGHTLY" })).rejects.toThrow("required for nightly");
    await expect(serviceService.updateInTransaction(client(), "biz_1", "haircut", { minUnits: 31 })).rejects.toThrow("minUnits cannot be more");
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it("validates the merged availability window on one-field updates", async () => {
    await expect(serviceService.updateInTransaction(client(), "biz_1", "haircut", { availableFrom: "18:00" })).rejects.toThrow("availableFrom must be earlier");
    expect(tx.service.update).not.toHaveBeenCalled();
  });

  it("clears nightly times when leaving nightly mode", async () => {
    Object.assign(service, { bookingMode: "NIGHTLY", checkInTime: "14:00", checkOutTime: "12:00" });
    await serviceService.updateInTransaction(client(), "biz_1", "haircut", { bookingMode: "DAILY" });
    expect(tx.service.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { bookingMode: "DAILY", checkInTime: null, checkOutTime: null } });
  });

  it("persists an already uploaded image separately from the validated patch", async () => {
    const result = await serviceService.updateInTransaction(client(), "biz_1", "haircut", { price: 12000 }, "new-photo");
    expect(result.image).toBe("new-photo");
    expect(cloudinaryService.uploadFile).not.toHaveBeenCalled();
  });

  it("preserves the image when no image URL is supplied", async () => {
    const result = await serviceService.updateInTransaction(client(), "biz_1", "haircut", { price: 12000 });
    expect(result.image).toBe("old-photo");
    expect(tx.service.update.mock.calls[0]![0].data).not.toHaveProperty("image");
  });
});
