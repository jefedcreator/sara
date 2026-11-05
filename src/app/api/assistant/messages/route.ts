import type { NextRequest } from "next/server";

import { assistantService } from "@/backend/services/assistant";
import { assistantResponse, readAssistantInput, withAssistantOwner } from "@/backend/services/assistant/http";
import { assertConversation } from "@/backend/services/assistant/store";

export const runtime = "nodejs";

/**
 * @description Sends one typed message or voice note to the authenticated business owner's web conversation.
 * @contentType application/json, multipart/form-data
 * @auth bearer
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAssistantOwner(request, async (scope) => {
    const { requestId, conversationId, input } = await readAssistantInput(request, request.signal);
    if (conversationId) await assertConversation(scope, conversationId);
    else await assistantService.conversation(scope);
    return assistantResponse(await assistantService.message({ scope, requestId, input }));
  });
}
