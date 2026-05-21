import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { monoService } from "@/backend/services/mono";
import { env } from "@/env";
import {
  ConflictException,
  InternalServerErrorException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

export const runtime = "nodejs";

/**
 * @description Returns the Mono Connect public key so the client can initialise
 *              the @mono.co/connect.js widget. The auth code is delivered to the
 *              client via the widget's onSuccess callback — never as a URL redirect.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request) => {
    try {
      const user = request.user!;

      if (user.business) {
        throw new ConflictException("You already have a business registered");
      }

    //   const monoPublicKey = monoService.getPublicKey();
      const response: ApiResponse<{ url: string }> = {
        status: 200,
        message: "Mono Connect public key retrieved successfully",
        data: { url:`${process.env.NEXT_PUBLIC_APP_URL}/mono` },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while retrieving the Mono public key: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);
