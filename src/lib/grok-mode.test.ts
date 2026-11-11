import { describe, expect, it } from "vitest";
import {
  augmentPromptWithGrokMode,
  GROK_FUN_INSTRUCTION,
  GROK_THINK_INSTRUCTION,
  stripGrokModeDirectives,
} from "./grok-mode";

describe("augmentPromptWithGrokMode", () => {
  it("leaves text unchanged in normal mode", () => {
    const raw = "What is quantum computing?";
    expect(augmentPromptWithGrokMode(raw, "normal")).toBe(raw);
  });

  it("prepends fun mode instruction when fun mode is active", () => {
    const raw = "Tell me a joke";
    const result = augmentPromptWithGrokMode(raw, "fun");
    expect(result).toContain(GROK_FUN_INSTRUCTION);
    expect(result).toContain(raw);
    expect(result).not.toContain(GROK_THINK_INSTRUCTION);
  });

  it("adds the fun directive once when the same text is prepared again", () => {
    const raw = "Explain black holes";
    const once = augmentPromptWithGrokMode(raw, "fun");
    expect(augmentPromptWithGrokMode(once, "fun")).toBe(once);
    expect(once.split(GROK_FUN_INSTRUCTION)).toHaveLength(2);
  });

  it("leaves a stored directive in place in normal mode", () => {
    const sent = augmentPromptWithGrokMode("Tell me a joke", "fun");
    expect(augmentPromptWithGrokMode(sent, "normal")).toBe(sent);
  });

  it("drops a stored think directive when preparing a fun message", () => {
    const stored = `${GROK_FUN_INSTRUCTION} ${GROK_THINK_INSTRUCTION}\n\nExplain black holes`;
    expect(augmentPromptWithGrokMode(stored, "fun")).toBe(`${GROK_FUN_INSTRUCTION}\n\nExplain black holes`);
  });
});

describe("stripGrokModeDirectives", () => {
  it("removes a leading fun or think directive and keeps the person's words", () => {
    expect(stripGrokModeDirectives(`${GROK_FUN_INSTRUCTION}\n\n  hello`)).toBe("  hello");
    expect(stripGrokModeDirectives(`${GROK_THINK_INSTRUCTION}\n\nSolve`)).toBe("Solve");
    expect(stripGrokModeDirectives(`${GROK_FUN_INSTRUCTION} ${GROK_THINK_INSTRUCTION}\n\nBoth`)).toBe("Both");
  });

  it("leaves a directive that is part of the message body", () => {
    const text = `See this\n\n${GROK_FUN_INSTRUCTION}`;
    expect(stripGrokModeDirectives(text)).toBe(text);
  });
});
