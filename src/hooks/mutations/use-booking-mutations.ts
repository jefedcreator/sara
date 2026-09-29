import { useMutation } from "@tanstack/react-query";
import type { PublicBookingInput } from "types";

import { api } from "@/utils/api";

/** Creates the booking, then hands the customer to Paystack. */
export function useCreatePublicBookingMutation() {
  return useMutation({
    mutationFn: (input: PublicBookingInput) => api.public.book(input),
    onSuccess: ({ paymentUrl }) => {
      window.location.assign(paymentUrl);
    },
  });
}
