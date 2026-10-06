import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/backend/services/auth", () => ({
  authService: {
    signOut: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://sara.84-12-92-46.sslip.io",
  },
}));

import { POST } from "./route";
import { authService } from "@/backend/services/auth";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes session and redirects to public origin instead of internal localhost:3003", async () => {
    const request = new NextRequest("https://localhost:3003/api/auth/logout", {
      method: "POST",
    });

    const response = await POST(request);

    expect(authService.signOut).toHaveBeenCalledWith(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://sara.84-12-92-46.sslip.io/",
    );
    expect(response.cookies.get("sara-auth")?.value).toBe("");
  });
});
