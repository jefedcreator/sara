import type { ChatChannel } from "@prisma/client";
import { instagramAdapter } from "./instagram";
import type { ChannelAdapter } from "./types";
import { whatsAppAdapter } from "./whatsapp";

export function adapterFor(channel: ChatChannel): ChannelAdapter {
  switch (channel) {
    case "WHATSAPP":
      return whatsAppAdapter;
    case "INSTAGRAM":
      return instagramAdapter;
  }
}
