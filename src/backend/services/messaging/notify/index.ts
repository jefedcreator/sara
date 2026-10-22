import { env } from "@/env";
import { db } from "@/server/db";
import { adapterFor } from "../channels/registry";
import { whatsAppAdapter } from "../channels/whatsapp";

/** Meta's "more than 24 hours since the customer last messaged" error. */
const OUTSIDE_WINDOW = 131047;

class OwnerNotifier {
  async notify(businessId: string, text: string): Promise<void> {
    const identities = await db.chatIdentity.findMany({
      where: { businessId },
      select: { channel: true, externalId: true },
    });

    await Promise.all(
      identities.map(async (identity) => {
        try {
          const result = await adapterFor(identity.channel).send(
            identity.externalId,
            { text },
          );

          // Free text only reaches an owner who messaged Sara in the last 24
          // hours; past that WhatsApp takes a template and nothing else.
          const template = env.WHATSAPP_ALERT_TEMPLATE;
          if (
            !result.ok &&
            result.code === OUTSIDE_WINDOW &&
            identity.channel === "WHATSAPP" &&
            template
          ) {
            await whatsAppAdapter.sendTemplate(identity.externalId, {
              name: template,
              language: env.WHATSAPP_ALERT_TEMPLATE_LANGUAGE || "en",
              // Meta refuses line breaks in a parameter.
              bodyParams: [text.replace(/\s*[\r\n]+\s*/g, " · ")],
            });
          }
        } catch (error: any) {
          console.warn(
            `[OwnerNotifier] failed to notify ${identity.channel}:${identity.externalId}:`,
            error?.message ?? error,
          );
        }
      }),
    );
  }
}

export const ownerNotifier = new OwnerNotifier();
