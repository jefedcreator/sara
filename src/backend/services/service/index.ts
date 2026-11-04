import { withSerializable } from "@/backend/services/assistant/transaction";
import { activeBookingWhere } from "@/backend/services/booking/conflicts";
import {
  bookingSetupProblem,
  serviceValidatorSchema,
  updateServiceValidatorSchema,
  type ServiceValidatorSchema,
  type UpdateServiceValidatorSchema,
} from "@/backend/validators/service.validator";
import { BadRequestException, ConflictException, NotFoundException } from "@/utils/exceptions";
import type { Prisma, Service } from "@prisma/client";
import slugify from "slugify";

type CreateServiceInput = Omit<ServiceValidatorSchema, "image">;
type UpdateServiceInput = Omit<UpdateServiceValidatorSchema, "image">;

async function uniqueSlug(tx: Prisma.TransactionClient, name: string, currentId?: string): Promise<string> {
  let slug = slugify(name, { lower: true, strict: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    const existing = await tx.service.findUnique({ where: { slug } });
    if (!existing || existing.id === currentId) return slug;
    slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
  }
  throw new ConflictException("Could not create a unique service link. Please try again.");
}

async function requireUniqueName(tx: Prisma.TransactionClient, businessId: string, name: string, excludeId?: string) {
  const existing = await tx.service.findFirst({
    where: { businessId, name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new ConflictException("A service with this name already exists.");
}

class ServiceService {
  async createInTransaction(
    tx: Prisma.TransactionClient,
    businessId: string,
    input: CreateServiceInput,
    imageUrl: string | null,
  ): Promise<Service> {
    const { image: _image, ...payload } = serviceValidatorSchema.parse(input);
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!business) throw new NotFoundException("Business not found");
    const problem = bookingSetupProblem(payload);
    if (problem) throw new BadRequestException(problem);
    await requireUniqueName(tx, businessId, payload.name);
    const slug = await uniqueSlug(tx, payload.name);
    return tx.service.create({
      data: {
        ...payload,
        business: { connect: { id: businessId } }, slug, image: imageUrl,
        checkInTime: payload.bookingMode === "NIGHTLY" ? payload.checkInTime : null,
        checkOutTime: payload.bookingMode === "NIGHTLY" ? payload.checkOutTime : null,
      },
    });
  }

  /** imageUrl is already uploaded by the web caller; undefined preserves the existing photo. */
  async updateInTransaction(
    tx: Prisma.TransactionClient,
    businessId: string,
    slug: string,
    patch: UpdateServiceInput,
    imageUrl?: string | null,
  ): Promise<Service> {
    const { image: _image, ...payload } = updateServiceValidatorSchema.parse(patch);
    const service = await tx.service.findFirst({
      where: { slug, businessId }, include: { business: { select: { name: true } } },
    });
    if (!service) throw new NotFoundException("Service not found");
    const merged = { ...service, ...payload };
    const problem = bookingSetupProblem(merged);
    if (problem) throw new BadRequestException(problem);
    if (merged.availableFrom >= merged.availableTo) {
      throw new BadRequestException("availableFrom must be earlier than availableTo");
    }
    if (merged.bookingMode !== service.bookingMode) {
      const upcoming = await tx.booking.count({
        where: { businessId, serviceId: service.id, endTime: { gt: new Date() }, AND: [activeBookingWhere()] },
      });
      if (upcoming > 0) throw new BadRequestException("Finish or cancel the upcoming bookings first.");
    }
    const data: Prisma.ServiceUpdateInput = { ...payload };
    if (payload.name !== undefined) {
      await requireUniqueName(tx, businessId, payload.name, service.id);
      data.slug = await uniqueSlug(tx, `${service.business.name}-${payload.name}`, service.id);
    }
    if (merged.bookingMode !== "NIGHTLY") {
      data.checkInTime = null;
      data.checkOutTime = null;
    }
    if (imageUrl !== undefined) data.image = imageUrl;
    return tx.service.update({ where: { id: service.id }, data });
  }

  async create(businessId: string, input: CreateServiceInput, imageUrl: string | null): Promise<Service> {
    return withSerializable((tx) => this.createInTransaction(tx, businessId, input, imageUrl));
  }

  async update(businessId: string, slug: string, patch: UpdateServiceInput, imageUrl?: string | null): Promise<Service> {
    return withSerializable((tx) => this.updateInTransaction(tx, businessId, slug, patch, imageUrl));
  }
}

export const serviceService = new ServiceService();
