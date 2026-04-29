import exifr from 'exifr';

interface ImageMetadata {
  dateCreated?: Date;
  dateModified?: Date;
  camera?: string;
  software?: string;
  gps?: {
    latitude?: number;
    longitude?: number;
  };
  dimensions?: {
    width?: number;
    height?: number;
  };
}

interface ValidationResult {
  isValid: boolean;
  metadata?: ImageMetadata;
  errors: string[];
}

export class ImageMetadataValidator {
  /**
   * Extract and validate metadata from an uploaded image file
   */
  async validateImageMetadata(file: File): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
    };

    try {
      // Check if file is an image
      if (!this.isImageFile(file)) {
        result.errors.push('File is not a valid image type');
        result.isValid = false;
        return result;
      }

      // Extract EXIF data
      const exifData = await exifr.parse(file);

      if (!exifData) {
        result.errors.push('No metadata found in image');
        result.isValid = false;
        return result;
      }

      // Parse metadata
      const metadata = this.parseMetadata(exifData);
      result.metadata = metadata;

      // Validate creation date
      this.validateCreationDate(metadata.dateCreated, result);

      // Additional validations can be added here
      this.validateImageDimensions(metadata.dimensions, result);
    } catch (error: any) {
      result.errors.push(`Error reading metadata: ${error}`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * Check if file is a valid image type
   */
  private isImageFile(file: File): boolean {
    const validTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'image/webp',
    ];
    return validTypes.includes(file.type.toLowerCase());
  }

  /**
   * Parse EXIF data into a structured format
   */
  private parseMetadata(exifData: any): ImageMetadata {
    const metadata: ImageMetadata = {};

    // Extract creation date (multiple possible fields)
    metadata.dateCreated =
      exifData.DateTimeOriginal ??
      exifData.CreateDate ??
      exifData.DateTime ??
      exifData.DateTimeDigitized;

    // Extract modification date
    metadata.dateModified = exifData.ModifyDate ?? exifData.DateTime;

    // Extract camera information
    if (exifData.Make && exifData.Model) {
      metadata.camera = `${exifData.Make} ${exifData.Model}`;
    }

    // Extract software information
    metadata.software = exifData.Software;

    // Extract GPS coordinates
    if (exifData.latitude && exifData.longitude) {
      metadata.gps = {
        latitude: exifData.latitude,
        longitude: exifData.longitude,
      };
    }

    // Extract image dimensions
    metadata.dimensions = {
      width: exifData.ExifImageWidth ?? exifData.ImageWidth,
      height: exifData.ExifImageHeight ?? exifData.ImageHeight,
    };

    return metadata;
  }

  /**
   * Validate the creation date
   */
  private validateCreationDate(
    dateCreated: Date | undefined,
    result: ValidationResult
  ): void {
    if (!dateCreated) {
      result.errors.push('No creation date found in image metadata');
      return;
    }

    const now = new Date();
    const minDate = new Date('1990-01-01'); // Reasonable minimum date for digital photos

    if (dateCreated > now) {
      result.errors.push('Image creation date is in the future');
      result.isValid = false;
    }

    if (dateCreated < minDate) {
      result.errors.push('Image creation date is unrealistically old');
      result.isValid = false;
    }

    // Check if the image was created within a specific timeframe (example: last 2 years)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(now.getFullYear() - 2);

    if (dateCreated < twoYearsAgo) {
      result.errors.push('Image is older than 2 years');
      // Note: This might be a warning rather than an error depending on your use case
    }
  }

  /**
   * Validate image dimensions
   */
  private validateImageDimensions(
    dimensions: { width?: number; height?: number } | undefined,
    result: ValidationResult
  ): void {
    if (!dimensions || !dimensions.width || !dimensions.height) {
      result.errors.push('Could not determine image dimensions');
      return;
    }

    const minWidth = 100;
    const minHeight = 100;
    const maxWidth = 10000;
    const maxHeight = 10000;

    if (dimensions.width < minWidth || dimensions.height < minHeight) {
      result.errors.push(
        `Image too small: ${dimensions.width}x${dimensions.height} (minimum: ${minWidth}x${minHeight})`
      );
      result.isValid = false;
    }

    if (dimensions.width > maxWidth || dimensions.height > maxHeight) {
      result.errors.push(
        `Image too large: ${dimensions.width}x${dimensions.height} (maximum: ${maxWidth}x${maxHeight})`
      );
      result.isValid = false;
    }
  }

  /**
   * Validate that image was created within a specific date range
   */
  validateDateRange(
    dateCreated: Date,
    startDate: Date,
    endDate: Date
  ): boolean {
    return dateCreated >= startDate && dateCreated <= endDate;
  }

  /**
   * Check if image was created on a specific date
   */
  validateSpecificDate(dateCreated: Date, targetDate: Date): boolean {
    return dateCreated.toDateString() === targetDate.toDateString();
  }
}

// Usage example:
export async function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  const validator = new ImageMetadataValidator();
  const result = await validator.validateImageMetadata(file);

  if (result.isValid && result.metadata) {
    console.log('Image validation passed!');
    console.log('Creation date:', result.metadata.dateCreated);
    console.log('Camera:', result.metadata.camera);
    console.log('Dimensions:', result.metadata.dimensions);
  } else {
    console.log('Image validation failed:');
    result.errors.forEach((error) => console.log('- ' + error));
  }
}
