import { authMiddleware, withMiddleware } from "@/backend/middleware";
import { assistantService } from "@/backend/services/assistant";
import {
  assistantErrorResponse,
  assistantResponse,
  readAssistantInput,
  requireAssistantOwner,
} from "@/backend/services/assistant/http";
import {
  assertConversation,
  controlTurn,
} from "@/backend/services/assistant/store";

export const runtime = "nodejs";

/**
 * @description Sends one typed message or voice note to the authenticated business owner's web conversation.
 * @contentType application/json, multipart/form-data
 * @auth bearer
 */
export const POST = withMiddleware<unknown>(
  async (request) => {
    // The body is read by hand, not by bodyValidatorMiddleware: it is bounded
    // before parsing and may carry one audio file. Auth runs first, so an
    // unauthenticated upload is never read.
    const scope = await requireAssistantOwner(request);
    const { requestId, conversationId, input } = await readAssistantInput(
      request,
      request.signal,
    );
    if (conversationId) await assertConversation(scope, conversationId);
    if (!conversationId) await assistantService.conversation(scope);
    if (input.kind === "text" && /^(?:menu|0|cancel)$/i.test(input.text)) {
      // Fence an in-flight interpretation before changing its pending context.
      // These exact typed controls never require OpenAI or consume a paid turn.
      return assistantResponse(
        await controlTurn(
          scope,
          requestId,
          input.text.toLowerCase() === "cancel" ? "cancel" : "menu",
        ),
      );
    }
    return assistantResponse(
      await assistantService.message({ scope, requestId, input }),
    );
  },
  [authMiddleware],
  assistantErrorResponse,
);
