import { z } from "zod";

import { env } from "@/env";

/** Hard stops that bound one assistant turn. */
export const TURN_TIMEOUT_MS = 25_000;
export const MAX_ROUNDS = 6;
export const MAX_OUTPUT_TOKENS = 2_000;
export const MAX_AUDIO_SECONDS = 120;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export type AssistantSettings = {
  enabled: boolean;
  available: boolean;
  dailyLimit: number;
  model: string;
  transcribeModel: string;
};

const settingsSchema = z.object({
  OPENAI_API_KEY: z.string().trim().optional(),
  OPENAI_ASSISTANT_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  OPENAI_TRANSCRIBE_MODEL: z.string().trim().min(1).default("whisper-1"),
  ASSISTANT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ASSISTANT_DAILY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
});

/**
 * Parse raw environment input. This exists so tests can exercise the exact
 * parsing rules without reloading the validated Next.js environment module.
 */
export function readAssistantSettings(
  raw: Record<string, unknown>,
): AssistantSettings {
  const value = settingsSchema.parse(raw);
  return {
    enabled: value.ASSISTANT_ENABLED,
    available: value.ASSISTANT_ENABLED && Boolean(value.OPENAI_API_KEY),
    dailyLimit: value.ASSISTANT_DAILY_LIMIT,
    model: value.OPENAI_ASSISTANT_MODEL,
    transcribeModel: value.OPENAI_TRANSCRIBE_MODEL,
  };
}

/**
 * Read the already-validated runtime environment. `ASSISTANT_ENABLED` has
 * already been transformed to a boolean by `src/env.js`, so it must not be
 * parsed again through the string-only test seam above.
 */
export function assistantConfig(): AssistantSettings {
  return {
    enabled: env.ASSISTANT_ENABLED,
    available: env.ASSISTANT_ENABLED && Boolean(env.OPENAI_API_KEY),
    dailyLimit: env.ASSISTANT_DAILY_LIMIT,
    model: env.OPENAI_ASSISTANT_MODEL,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL,
  };
}
