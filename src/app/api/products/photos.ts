import type { AuthRequest } from "@/backend/middleware/types";
import { cloudinaryService } from "@/backend/services/cloudinary";

/** Every `photos` entry in the multipart body, in the order the owner picked. */
export function photosFrom(request: AuthRequest): File[] {
  return (request.rawFormData?.getAll("photos") ?? []).filter(
    (entry): entry is File =>
      entry instanceof File && entry.size > 0 && entry.name !== "",
  );
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
