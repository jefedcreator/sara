import type { NextRequest } from "next/server";

import { approveAction } from "@/backend/services/assistant/actions/approve";
import { assistantResponse, readAssistantDraftInput, requireAssistantAction, withAssistantOwner } from "@/backend/services/assistant/http";

export const runtime = "nodejs";

/**
 * @description Approves the exact stored draft for the authenticated owner's supplied web conversation.
 * @contentType application/json
 * @auth bearer
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAssistantOwner(request, async (scope) => {
    const { conversationId } = await readAssistantDraftInput(request);
    const { id } = await context.params;
    await requireAssistantAction(scope, conversationId, id);
    return assistantResponse(await approveAction(scope, id, new Date()));
  });
}
