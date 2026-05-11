import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/server/db";

const sessionCookieName = "sara-session";

export const POST = async (request: NextRequest) => {
  const sessionToken = request.cookies.get(sessionCookieName)?.value;

  if (sessionToken) {
    await db.session.deleteMany({
      where: { sessionToken },
    });
  }

  const response = NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });

  response.cookies.delete(sessionCookieName);
  return response;
};
