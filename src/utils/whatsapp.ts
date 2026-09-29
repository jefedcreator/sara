import { env } from "@/env";

/** Sara's WhatsApp chat, opened with a first message ready to send. */
export function whatsappHref(text = "Hi Sara") {
  const number = env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER;
  return number
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : "https://wa.me/";
}
