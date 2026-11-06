import OpenAI from "openai";

import { env } from "@/env";

import { assistantConfig, TURN_TIMEOUT_MS } from "./config";

let client: OpenAI | null = null;

/**
 * Build the SDK client only when an assistant turn actually needs it. A
 * missing key must never make importing the messaging stack fail: the
 * numbered menu has to keep working without an OpenAI account.
 */
export function getOpenAI(): OpenAI {
  const config = assistantConfig();
  if (!config.available || !env.OPENAI_API_KEY) {
    throw new Error("ASSISTANT_UNAVAILABLE");
  }
  client ??= new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: TURN_TIMEOUT_MS,
  });
  return client;
}
