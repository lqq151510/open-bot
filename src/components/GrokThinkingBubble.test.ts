import { describe, expect, it } from "vitest";
import { extractThinkingBlock } from "./GrokThinkingBubble";

describe("extractThinkingBlock", () => {
  it("returns unchanged content when no think tag is present", () => {
    const raw = "Hello world, this is a normal response.";
    const result = extractThinkingBlock(raw);
    expect(result.thought).toBeNull();
    expect(result.inProgress).toBe(false);
    expect(result.content).toBe(raw);
  });

  it("extracts completed think block", () => {
    const raw = "<think>Planning to say hello</think>Hello world!";
    const result = extractThinkingBlock(raw);
    expect(result.thought).toBe("Planning to say hello");
    expect(result.inProgress).toBe(false);
    expect(result.content).toBe("Hello world!");
  });

  it("extracts completed thought block case-insensitively", () => {
    const raw = "<THOUGHT>Deep reasoning step 1\nStep 2</THOUGHT>Final Answer";
    const result = extractThinkingBlock(raw);
    expect(result.thought).toBe("Deep reasoning step 1\nStep 2");
    expect(result.inProgress).toBe(false);
    expect(result.content).toBe("Final Answer");
  });

  it("handles in-progress thinking stream without closing tag", () => {
    const raw = "<think>Still reasoning about the question...";
    const result = extractThinkingBlock(raw);
    expect(result.thought).toBe("Still reasoning about the question...");
    expect(result.inProgress).toBe(true);
    expect(result.content).toBe("");
  });

  it("preserves content before think tag if any", () => {
    const raw = "Prefix info\n<think>Reasoning...</think>\nBody content";
    const result = extractThinkingBlock(raw);
    expect(result.thought).toBe("Reasoning...");
    expect(result.inProgress).toBe(false);
    expect(result.content).toBe("Prefix info\n\nBody content");
  });
});
