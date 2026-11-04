import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: {
    OPENAI_API_KEY: "sk-test" as string | undefined,
    OPENAI_ASSISTANT_MODEL: "gpt-5.4-mini",
    OPENAI_TRANSCRIBE_MODEL: "whisper-1",
    ASSISTANT_ENABLED: true,
    ASSISTANT_DAILY_LIMIT: 100,
  },
}));

const constructor = vi.hoisted(() => vi.fn());

vi.mock("@/env", () => ({ env: state.env }));
vi.mock("openai", () => ({ default: constructor }));

beforeEach(() => {
  vi.resetModules();
  constructor.mockReset();
  state.env.OPENAI_API_KEY = "sk-test";
  state.env.ASSISTANT_ENABLED = true;
});

describe("getOpenAI", () => {
  it("does not construct a client until it is called", async () => {
    await import("./openai");
    expect(constructor).not.toHaveBeenCalled();
  });

  it("creates one lazy client with retries off and the turn timeout", async () => {
    const { getOpenAI } = await import("./openai");
    const first = getOpenAI();
    const second = getOpenAI();

    expect(first).toBe(second);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(constructor).toHaveBeenCalledWith({
      apiKey: "sk-test",
      maxRetries: 0,
      timeout: 25_000,
    });
  });

  it("respects the off switch after a client was cached", async () => {
    const { getOpenAI } = await import("./openai");
    getOpenAI();
    state.env.ASSISTANT_ENABLED = false;
    expect(() => getOpenAI()).toThrow("ASSISTANT_UNAVAILABLE");
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it("imports safely without a key and refuses to build a client", async () => {
    state.env.OPENAI_API_KEY = undefined;
    const { getOpenAI } = await import("./openai");
    expect(() => getOpenAI()).toThrow("ASSISTANT_UNAVAILABLE");
    expect(constructor).not.toHaveBeenCalled();
  });

  it("refuses a configured but disabled assistant", async () => {
    state.env.ASSISTANT_ENABLED = false;
    const { getOpenAI } = await import("./openai");
    expect(() => getOpenAI()).toThrow("ASSISTANT_UNAVAILABLE");
    expect(constructor).not.toHaveBeenCalled();
  });
});
