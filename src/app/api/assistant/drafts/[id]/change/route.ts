import {
  authMiddleware,
  pathParamValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { changeDraft } from "@/backend/services/assistant/actions/drafts";
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
 * @description Marks this stored draft for editing and asks the authenticated owner what should change.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<z.infer<typeof assistantDraftValidatorSchema>>(
  async (request) => {
    const scope = await requireAssistantOwner(request);
    const { conversationId } = await readAssistantDraftInput(request);
    const { id } = request.params! as { id: string };
    await requireAssistantAction(scope, conversationId, id);
    const draft = await changeDraft(scope, id);
    return assistantResponse({
      conversationId,
      reply: "What should change?" as const,
      draft,
    });
  },
  [authMiddleware, pathParamValidatorMiddleware(idParamSchema)],
  assistantErrorResponse,
);
