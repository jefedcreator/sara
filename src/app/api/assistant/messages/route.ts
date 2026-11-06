import type { NextRequest } from "next/server";

import { assistantService } from "@/backend/services/assistant";
import { assistantResponse, readAssistantInput, withAssistantOwner } from "@/backend/services/assistant/http";
import { assertConversation, controlTurn } from "@/backend/services/assistant/store";

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
    if (!conversationId) await assistantService.conversation(scope);
    if (input.kind === "text" && /^(?:menu|0|cancel)$/i.test(input.text)) {
      // Fence an in-flight interpretation before changing its pending context.
      // These exact typed controls never require OpenAI or consume a paid turn.
      return assistantResponse(await controlTurn(scope, requestId, input.text.toLowerCase() === "cancel" ? "cancel" : "menu"));
    }
    return assistantResponse(await assistantService.message({ scope, requestId, input }));
  });
}
