import { useMutation } from "@tanstack/react-query";

import { api } from "@/utils/api";

export function useLinkChatMutation() {
  return useMutation({ mutationFn: (token: string) => api.messaging.link(token) });
}
