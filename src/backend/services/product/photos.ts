import type { AuthRequest } from "@/backend/middleware/types";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { MAX_PHOTOS } from "@/backend/validators/product.validator";
import { UnprocessableEntityException } from "@/utils/exceptions";

/**
 * Every `photos` entry in the multipart body, in the order the owner picked.
 * Read from the whole form: `bodyValidatorMiddleware` keeps one file per key.
 */
export function photosFrom(request: AuthRequest<unknown, unknown>): File[] {
  return (request.rawFormData?.getAll("photos") ?? []).filter(
    (entry): entry is File =>
      entry instanceof File && entry.size > 0 && entry.name !== "",
  );
}

/**
 * Refuse a product that would end up with too many photos before any of them
 * is uploaded, so a rejected request leaves nothing behind on Cloudinary.
 */
export function assertPhotoCount(count: number): void {
  if (count > MAX_PHOTOS) {
    throw new UnprocessableEntityException(
      `A product can have up to ${MAX_PHOTOS} photos`,
    );
  }
}

/** Upload product photos and return their URLs, ready for the product service. */
export async function uploadPhotos(
  businessId: string,
  photos: File[],
): Promise<string[]> {
  return Promise.all(
    photos.map(async (photo) => {
      const upload = await cloudinaryService.uploadFile(photo, {
        folder: `sara/${businessId}/products`,
      });
      return upload.secure_url;
    }),
  );
}
