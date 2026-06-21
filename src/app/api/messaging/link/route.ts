import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { linkingService } from "@/backend/services/messaging/linking";
import {
  linkValidatorSchema,
  type LinkValidatorSchema,
} from "@/backend/services/messaging/linking/validator";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @body LinkValidatorSchema
 * @description Binds a WhatsApp/Instagram chat identity (from a link token) to the
 *              authenticated owner's business.
 * @auth bearer
 */
export const POST = withMiddleware<LinkValidatorSchema>(
  async (request) => {
    try {
      const { token } = request.validatedData!;
      const user = request.user!;
      const business = user.business;
      if (!business) throw new NotFoundException("Business not found");
      if (business.ownerId !== user.id) {
        throw new ForbiddenException("You cannot link a chat to this business");
      }

      await linkingService.consumeToken(token, business.id);

      return NextResponse.json({
        status: 200,
        message: "Your chat is now connected. Send a message to get started.",
      });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while linking chat: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(linkValidatorSchema)],
);
