import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedEnv = vi.hoisted(
  () =>
    ({
      OPENAI_API_KEY: "sk-test",
      OPENAI_ASSISTANT_MODEL: "gpt-5.4-mini",
      OPENAI_TRANSCRIBE_MODEL: "whisper-1",
      ASSISTANT_ENABLED: true,
      ASSISTANT_DAILY_LIMIT: 100,
    }) as {
      OPENAI_API_KEY?: string;
      OPENAI_ASSISTANT_MODEL: string;
      OPENAI_TRANSCRIBE_MODEL: string;
      ASSISTANT_ENABLED: boolean;
      ASSISTANT_DAILY_LIMIT: number;
    },
);

vi.mock("@/env", () => ({ env: mockedEnv }));

import { assistantConfig, readAssistantSettings } from "./config";

beforeEach(() => {
  mockedEnv.OPENAI_API_KEY = "sk-test";
  mockedEnv.OPENAI_ASSISTANT_MODEL = "gpt-5.4-mini";
  mockedEnv.OPENAI_TRANSCRIBE_MODEL = "whisper-1";
  mockedEnv.ASSISTANT_ENABLED = true;
  mockedEnv.ASSISTANT_DAILY_LIMIT = 100;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readAssistantSettings", () => {
  it("applies the model and quota defaults", () => {
    expect(readAssistantSettings({})).toEqual({
      enabled: true,
      available: false,
      dailyLimit: 100,
      model: "gpt-5.4-mini",
      transcribeModel: "whisper-1",
    });
  });

  it("parses the off switch explicitly", async () => {
    vi.stubEnv("ASSISTANT_ENABLED", "false");
    vi.resetModules();
    const { readAssistantSettings: fresh } = await import("./config");
    expect(fresh(process.env).enabled).toBe(false);
  });

  it("rejects a zero daily limit", () => {
    expect(() =>
      readAssistantSettings({ ASSISTANT_DAILY_LIMIT: "0" }),
    ).toThrow();
  });

  it("rejects a non-numeric daily limit", () => {
    expect(() =>
      readAssistantSettings({ ASSISTANT_DAILY_LIMIT: "many" }),
    ).toThrow();
  });

  it("is available only when enabled and keyed", () => {
    expect(
      readAssistantSettings({ OPENAI_API_KEY: " sk-test " }).available,
    ).toBe(true);
    expect(
      readAssistantSettings({
        OPENAI_API_KEY: "sk-test",
        ASSISTANT_ENABLED: "false",
      }).available,
    ).toBe(false);
    expect(
      readAssistantSettings({ OPENAI_API_KEY: "" }).available,
    ).toBe(false);
  });
});

describe("assistantConfig", () => {
  it("maps the already-transformed runtime boolean without reparsing it", () => {
    mockedEnv.OPENAI_API_KEY = "sk-test";
    mockedEnv.ASSISTANT_ENABLED = false;
    expect(assistantConfig()).toEqual({
      enabled: false,
      available: false,
      dailyLimit: 100,
      model: "gpt-5.4-mini",
      transcribeModel: "whisper-1",
    });
  });

  it("reports unavailable without a key", () => {
    mockedEnv.OPENAI_API_KEY = undefined;
    expect(assistantConfig().available).toBe(false);
  });
});
