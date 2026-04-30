import { env } from "@/env";
import crypto from "node:crypto";

type CloudinaryParamValue = boolean | number | string | undefined;

export interface CloudinaryUploadOptions {
  filename?: string;
  folder?: string;
  format?: string;
  mime_type?: string;
  overwrite?: boolean;
  public_id?: string;
  resource_type?: "auto" | "image" | "raw" | "video";
  unique_filename?: boolean;
  use_filename?: boolean;
  [key: string]: CloudinaryParamValue;
}

export type CloudinaryUploadResponse = {
  asset_id: string;
  public_id: string;
  version: number;
  resource_type: string;
  type: string;
  format?: string;
  bytes: number;
  url: string;
  secure_url: string;
};

class CloudinaryService {
  private getConfig() {
    if (
      !env.CLOUDINARY_CLOUD_NAME ||
      !env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Cloudinary environment variables are not configured");
    }

    return {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
    };
  }

  private signParams(params: Record<string, string>, apiSecret: string) {
    const signaturePayload = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    return crypto
      .createHash("sha1")
      .update(`${signaturePayload}${apiSecret}`)
      .digest("hex");
  }

  private normalizeParams(options: CloudinaryUploadOptions) {
    return Object.entries(options).reduce<Record<string, string>>(
      (params, [key, value]) => {
        if (
          key === "filename" ||
          key === "mime_type" ||
          key === "resource_type" ||
          value === undefined
        ) {
          return params;
        }

        params[key] = String(value);
        return params;
      },
      {},
    );
  }

  /**
   * Uploads a file buffer to Cloudinary.
   * @param fileBuffer - The buffer of the file to upload.
   * @param options - Cloudinary upload options.
   * @returns A promise that resolves to the upload response.
   */
  async uploadImage(
    fileBuffer: Buffer,
    options: CloudinaryUploadOptions = {},
  ): Promise<CloudinaryUploadResponse> {
    const { cloudName, apiKey, apiSecret } = this.getConfig();
    const {
      filename,
      folder = "strive",
      mime_type,
      resource_type = "auto",
      ...rest
    } = options;
    const uploadParams = this.normalizeParams({
      folder,
      ...rest,
      timestamp: Math.floor(Date.now() / 1000),
    });

    const signature = this.signParams(uploadParams, apiSecret);
    const formData = new FormData();

    Object.entries(uploadParams).forEach(([key, value]) => {
      formData.append(key, value);
    });
    formData.append("api_key", apiKey);
    formData.append("signature", signature);
    formData.append(
      "file",
      new Blob([new Uint8Array(fileBuffer)], { type: mime_type }),
      filename ?? rest.public_id ?? "upload",
    );

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resource_type}/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    const result = (await response.json().catch(() => null)) as
      | (CloudinaryUploadResponse & { error?: { message?: string } })
      | null;

    if (!response.ok || !result) {
      throw new Error(
        result?.error?.message ?? "Failed to upload file to Cloudinary",
      );
    }

    return result;
  }

  /**
   * Uploads a File object (from FormData) to Cloudinary.
   * @param file - The File object to upload.
   * @param options - Cloudinary upload options.
   * @returns A promise that resolves to the upload response.
   */
  async uploadFile(
    file: File,
    options: CloudinaryUploadOptions = {},
  ): Promise<CloudinaryUploadResponse> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return this.uploadImage(buffer, options);
  }

  /**
   * Deletes an image from Cloudinary using its public ID.
   * @param publicId - The public ID of the image to delete.
   * @returns A promise that resolves when the image is deleted.
   */
  async deleteImage(publicId: string): Promise<void> {
    const { cloudName, apiKey, apiSecret } = this.getConfig();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = {
      public_id: publicId,
      timestamp,
    };
    const signature = this.signParams(params, apiSecret);
    const formData = new FormData();

    formData.append("public_id", publicId);
    formData.append("timestamp", timestamp);
    formData.append("api_key", apiKey);
    formData.append("signature", signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      throw new Error("Failed to delete image from Cloudinary");
    }
  }

  /**
   * Generates a transformed URL for an image.
   * @param publicId - The public ID of the image.
   * @param transformations - Transformation options.
   * @returns The transformed URL.
   */
  getTransformedUrl(
    publicId: string,
    transformations: Record<string, string | number> = {},
  ): string {
    const { cloudName } = this.getConfig();
    const transformationPath = Object.entries(transformations)
      .map(([key, value]) => `${key}_${value}`)
      .join(",");

    return `https://res.cloudinary.com/${cloudName}/image/upload/${
      transformationPath ? `${transformationPath}/` : ""
    }${publicId}`;
  }
}

export const cloudinaryService = new CloudinaryService();
