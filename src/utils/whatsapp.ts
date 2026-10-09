import { env } from "@/env";

export const DEFAULT_SARA_WHATSAPP_NUMBER = "15556551373";

/** Sara's WhatsApp chat, opened with a first message ready to send. */
export function whatsappHref(text = "Hi Sara") {
  const raw =
    env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER ??
    process.env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER ??
    DEFAULT_SARA_WHATSAPP_NUMBER;

  const digits = raw.replace(/\D/g, "");
  const cleanNumber = digits.length > 0 ? digits : DEFAULT_SARA_WHATSAPP_NUMBER;
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}
