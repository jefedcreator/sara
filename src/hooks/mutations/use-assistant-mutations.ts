import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActionResult, ResourceKind } from "@/types";

import { bookingKeys } from "@/hooks/queries/use-bookings";
import { customerKeys } from "@/hooks/queries/use-customers";
import { dashboardKeys } from "@/hooks/queries/use-dashboard";
import { invoiceKeys } from "@/hooks/queries/use-invoices";
import { orderKeys } from "@/hooks/queries/use-orders";
import { productKeys } from "@/hooks/queries/use-products";
import { receiptKeys } from "@/hooks/queries/use-receipts";
import { serviceKeys } from "@/hooks/queries/use-services";
import { api } from "@/utils/api";

const affectedKeys = {
  invoices: invoiceKeys.all,
  receipts: receiptKeys.all,
  orders: orderKeys.all,
  products: productKeys.all,
  services: serviceKeys.all,
  bookings: bookingKeys.all,
  customers: customerKeys.all,
  dashboard: dashboardKeys.all,
} satisfies Record<ResourceKind, readonly string[]>;

function useInvalidateAssistantResult() {
  const queryClient = useQueryClient();
  return (result: ActionResult | null) => {
    if (!result) return;
    for (const resource of new Set(result.affected)) {
      void queryClient.invalidateQueries({ queryKey: affectedKeys[resource] });
    }
  };
}

export function useAssistantMessageMutation() {
  const invalidate = useInvalidateAssistantResult();
  return useMutation({
    mutationFn: api.assistant.message,
    retry: false,
    onSuccess: (reply) => invalidate(reply.result),
  });
}

export type AssistantDraftInput = { conversationId: string; actionId: string };

export function useAssistantApproveMutation() {
  const invalidate = useInvalidateAssistantResult();
  return useMutation({
    mutationFn: ({ conversationId, actionId }: AssistantDraftInput) => api.assistant.approve(conversationId, actionId),
    retry: false,
    onSuccess: (reply) => invalidate(reply.result),
  });
}

export function useAssistantChangeMutation() {
  return useMutation({
    mutationFn: ({ conversationId, actionId }: AssistantDraftInput) => api.assistant.change(conversationId, actionId),
    retry: false,
  });
}
