import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { db } from "@/server/db";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @pathParams id
 * @description Deletes a one-off closure by id. Uses the cuid `id` rather
 *              than a `slug` — closures are never addressed outside the
 *              owning business's own admin calls, so a slug would be
 *              unjustified complexity.
 * @auth bearer
 */
export const DELETE = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const { id } = params;

      if (!id) {
        throw new NotFoundException("Closure not found");
      }

      const closure = await db.businessClosure.findUnique({ where: { id } });

      if (!closure) {
        throw new NotFoundException("Closure not found");
      }

      if (!user.business || closure.businessId !== user.business.id) {
        throw new ForbiddenException(
          "You are not authorized to delete this closure",
        );
      }

      await db.businessClosure.delete({ where: { id } });

      const response: ApiResponse<{ id: string }> = {
        status: 200,
        message: "Closure deleted successfully",
        data: { id },
      };

      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while deleting the closure: ${error.message}`,
      );
    }
  },
  [authMiddleware],
);
