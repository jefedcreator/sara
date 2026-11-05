import type { NextRequest } from "next/server";

import { changeDraft } from "@/backend/services/assistant/actions/drafts";
import { assistantResponse, readAssistantDraftInput, requireAssistantAction, withAssistantOwner } from "@/backend/services/assistant/http";

export const runtime = "nodejs";

/**
 * @description Marks this stored draft for editing and asks the authenticated owner what should change.
 * @contentType application/json
 * @auth bearer
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAssistantOwner(request, async (scope) => {
    const { conversationId } = await readAssistantDraftInput(request);
    const { id } = await context.params;
    await requireAssistantAction(scope, conversationId, id);
    const draft = await changeDraft(scope, id);
    return assistantResponse({ conversationId, reply: "What should change?" as const, draft });
  });
}
