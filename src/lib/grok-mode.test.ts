import { describe, expect, it } from "vitest";
import {
  augmentPromptWithGrokMode,
  GROK_FUN_INSTRUCTION,
  GROK_THINK_INSTRUCTION,
} from "./grok-mode";

describe("augmentPromptWithGrokMode", () => {
  it("leaves text unchanged when in normal mode with think disabled", () => {
    const raw = "What is quantum computing?";
    const result = augmentPromptWithGrokMode(raw, "normal", false);
    expect(result).toBe(raw);
  });

  it("prepends fun mode instruction when fun mode is active", () => {
    const raw = "Tell me a joke";
    const result = augmentPromptWithGrokMode(raw, "fun", false);
    expect(result).toContain(GROK_FUN_INSTRUCTION);
    expect(result).toContain(raw);
  });

  it("prepends think instruction when think mode is active", () => {
    const raw = "Solve this equation: 2x + 5 = 15";
    const result = augmentPromptWithGrokMode(raw, "normal", true);
    expect(result).toContain(GROK_THINK_INSTRUCTION);
    expect(result).toContain(raw);
  });

  it("combines both fun and think instructions when both are active", () => {
    const raw = "Explain black holes";
    const result = augmentPromptWithGrokMode(raw, "fun", true);
    expect(result).toContain(GROK_FUN_INSTRUCTION);
    expect(result).toContain(GROK_THINK_INSTRUCTION);
    expect(result).toContain(raw);
  });
});
