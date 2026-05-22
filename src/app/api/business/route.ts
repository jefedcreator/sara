import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { atlasService } from "@/backend/services/atlas";
import { monoService } from "@/backend/services/mono";
import { paystackService } from "@/backend/services/paystack";
import {
  businessValidatorSchema,
  updateBusinessValidatorSchema,
  type BusinessValidatorSchema,
  type UpdateBusinessValidatorSchema,
} from "@/backend/validators/business.validator";
import { db } from "@/server/db";
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import slugify from "slugify";
import type { ApiResponse } from "types";

export const runtime = "nodejs";

/**
 * @description Gets the business for the authenticated user.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const response: ApiResponse = {
        status: 200,
        message: "Business retrieved successfully",
        data: business,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching business: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body BusinessValidatorSchema
 * @description Creates a new business for the authenticated user.
 *
 *              SANDBOX BEHAVIOUR:
 *              `monoCode` is copied manually from the Mono Connect widget UI
 *              after a test connection. No state token or redirect is involved.
 *              `monoCode` is optional — omitting it creates the business without
 *              bank linking so you can test the rest of the onboarding flow
 *              independently.
 *
 * @auth bearer
 */
export const POST = withMiddleware<BusinessValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      if (user.business) {
        throw new ConflictException("You already have a business registered");
      }

      const { monoCode, ...businessData } = payload;
      console.log('monoCode', monoCode);

      // --- Slug ---
      const slug =
        businessData.slug ||
        slugify(businessData.name, { lower: true, strict: true });

      const existingSlug = await db.business.findUnique({ where: { slug } });
      if (existingSlug) {
        throw new ConflictException("A business with this slug already exists");
      }

      // --- Atlas auto-geocoding (address → lat/lng) ---
      if (businessData.address && !businessData.latitude && !businessData.longitude) {
        try {
          const parts = [businessData.address, businessData.city, businessData.state, businessData.country]
            .filter(Boolean)
            .join(", ");
          const results = await atlasService.geocode(parts, { limit: 1, country: "NG" });
          if (results.length > 0) {
            businessData.latitude = results[0]!.lat;
            businessData.longitude = results[0]!.lon;
          }
        } catch (geoError: any) {
          // Geocoding failure is non-fatal — business is still created without coordinates
          console.warn("Atlas geocoding failed:", geoError.message);
        }
      }


      // --- Mono → Paystack bank linking (optional in sandbox) ---
      type SettlementData = {
        settlementBank?: string;
        settlementAccount?: string;
        settlementAccountName?: string;
        paystackSubaccountCode?: string;
        monoAccountId?: string;
      };

      let settlementData: SettlementData = {};
      let bankLinkStatus: "LINKED" | "FAILED" | "PENDING" = "PENDING";

      // if (monoCode) {
      //   try {
      // 1. Exchange the sandbox code (copied from widget) for a Mono account ID
      const { id: monoAccountId } =
        await monoService.exchangeToken(monoCode);
      console.log('monoAccountId', monoAccountId);

      // 2. Fetch test bank account details from Mono
      const accountDetails =
        await monoService.getAccountDetails(monoAccountId);
      console.log('accountDetails', accountDetails);

      // 3. Create a Paystack subaccount with the test bank details
      const subaccount = await paystackService.createSubaccount({
        businessName: businessData.name,
        settlementBank: accountDetails.institution.bank_code,
        accountNumber: accountDetails.account_number,
        primaryContactEmail: businessData.email,
        primaryContactName: user.name ?? undefined,
        primaryContactPhone: businessData.phone,
      });

      settlementData = {
        monoAccountId,
        settlementBank: accountDetails.institution.bank_code,
        settlementAccount: accountDetails.account_number,
        settlementAccountName: accountDetails.name,
        paystackSubaccountCode: subaccount.subaccount_code,
      };

      bankLinkStatus = "LINKED";
      //   } catch (linkError: any) {
      //     // Linking failed — business is still created so the rest of onboarding
      //     // can be tested. The FAILED status lets the client nudge the user to retry.
      //     bankLinkStatus = "FAILED";
      //     console.error("Bank linking failed:", linkError.message);
      //   }
      // }

      // --- Persist ---
      const business = await db.business.create({
        data: {
          ...businessData,
          ...settlementData,
          slug,
          ownerId: user.id,
          // bankLinkStatus,
          // LINKED  → bank fully connected, ready to receive payments
          // FAILED  → monoCode was provided but linking errored, retry available
          // PENDING → no monoCode provided, user skipped bank linking for now
        },
      });

      const messages = {
        LINKED: "Business created successfully with bank account linked",
        FAILED:
          "Business created, but bank linking failed. You can retry from your settings.",
        PENDING:
          "Business created successfully. Connect your bank account from settings to receive payments.",
      };

      const response: ApiResponse = {
        status: 201,
        message: messages[bankLinkStatus],
        data: business,
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while creating business: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(businessValidatorSchema)],
);

/**
 * @body UpdateBusinessValidatorSchema
 * @description Updates the existing business for the authenticated user.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateBusinessValidatorSchema>(
  async (request) => {
    try {
      const payload = request.validatedData!;
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("No business found to update");
      }

      let slug = user.business.slug;

      if (payload.name || payload.slug) {
        if (payload.name) {
          slug = slugify(payload.name, { lower: true, strict: true });
        } else if (payload.slug) {
          slug = payload.slug;
        }
        // Check if new slug is taken by someone else
        if (slug !== user.business.slug) {
          const existingBusinessWithSlug = await db.business.findUnique({
            where: { slug },
          });
          if (existingBusinessWithSlug) {
            throw new ConflictException(
              "A business with this slug already exists",
            );
          }
        }
      }

      const business = await db.business.update({
        where: { ownerId: user.id },
        data: {
          ...payload,
          slug,
        },
      });

      const response: ApiResponse = {
        status: 200,
        message: "Business updated successfully",
        data: business,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating business: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateBusinessValidatorSchema)],
);

/**
 * @description Deletes the business for the authenticated user.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (!user.business) {
        throw new NotFoundException("No business found to delete");
      }

      await db.business.delete({
        where: { ownerId: user.id },
      });

      const response: ApiResponse = {
        status: 200,
        message: "Business deleted successfully",
        data: null,
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting business: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);
