import { authMiddleware, pathParamValidatorMiddleware, withMiddleware } from "@/backend/middleware";
import { approveAction } from "@/backend/services/assistant/actions/approve";
import {
  assistantErrorResponse,
  assistantResponse,
  readAssistantDraftInput,
  requireAssistantAction,
  requireAssistantOwner,
} from "@/backend/services/assistant/http";
import { assistantConversationIdSchema } from "@/backend/validators/assistant.validator";
import type { assistantDraftValidatorSchema } from "@/backend/validators/assistant.validator";
import { z } from "zod";

export const runtime = "nodejs";

const idParamSchema = z
  .object({ id: assistantConversationIdSchema })
  .strict();

/**
 * @body AssistantDraftValidatorSchema
 * @description Approves the exact stored draft for the authenticated owner's supplied web conversation.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<z.infer<typeof assistantDraftValidatorSchema>>(
  async (request) => {
    const scope = await requireAssistantOwner(request);
    const { conversationId } = await readAssistantDraftInput(request);
    const { id } = request.params! as { id: string };
    await requireAssistantAction(scope, conversationId, id);
    return assistantResponse(await approveAction(scope, id, new Date()));
  },
  [authMiddleware, pathParamValidatorMiddleware(idParamSchema)],
  assistantErrorResponse,
);
