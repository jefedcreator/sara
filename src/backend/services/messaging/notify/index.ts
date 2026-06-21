import { db } from "@/server/db";
import { adapterFor } from "../channels/registry";

class OwnerNotifier {
  async notify(businessId: string, text: string): Promise<void> {
    const identities = await db.chatIdentity.findMany({
      where: { businessId },
      select: { channel: true, externalId: true },
    });

    await Promise.all(
      identities.map(async (identity) => {
        try {
          await adapterFor(identity.channel).send(identity.externalId, { text });
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
