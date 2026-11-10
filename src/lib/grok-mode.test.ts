import { describe, expect, it } from "vitest";
import { GROK_FUN_BLOCK, grokComposerModel, grokFunToggle, grokThinkSelection, soulHasGrokFun, soulWithGrokFun } from "./grok-mode";

describe("soulWithGrokFun", () => {
  it("puts the fun paragraph on an empty instruction", () => {
    const next = soulWithGrokFun("", true);
    expect(next).toBe(GROK_FUN_BLOCK);
    expect(soulHasGrokFun(next!)).toBe(true);
    expect(soulWithGrokFun(next!, false)).toBe("");
  });

  it("keeps the instructions that were already there", () => {
    const next = soulWithGrokFun("Be brief.", true);
    expect(next).toBe(`Be brief.\n\n${GROK_FUN_BLOCK}`);
    expect(soulWithGrokFun(next!, false)).toBe("Be brief.");
  });

  it("leaves an open paragraph unchanged, including an edited line", () => {
    const once = soulWithGrokFun("Be brief.", true)!;
    expect(soulWithGrokFun(once, true)).toBe(once);
    const edited = once.replace("witty", "gentle");
    expect(soulWithGrokFun(edited, true)).toBe(edited);
    expect(soulWithGrokFun(edited, false)).toBe("Be brief.");
  });

  it("keeps text on both sides of the paragraph", () => {
    const soul = `Be brief.\n\n${GROK_FUN_BLOCK}\n\nAlso kind.`;
    expect(soulWithGrokFun(soul, false)).toBe("Be brief.\n\nAlso kind.");
  });

  it("leaves a closed instruction untouched", () => {
    expect(soulWithGrokFun("Be brief.\n", false)).toBe("Be brief.\n");
    expect(soulHasGrokFun("Be brief.")).toBe(false);
  });

  it("refuses a paragraph that would pass the instruction limit", () => {
    const soul = "Be brief.";
    expect(soulWithGrokFun(soul, true, soul.length)).toBeNull();
    const open = soulWithGrokFun(soul, true)!;
    expect(soulWithGrokFun(open, true, 10)).toBe(open);
  });
});

describe("grok composer controls", () => {
  it("shows Fun on a Grok CLI bot, and Think only when high effort is offered", () => {
    expect(grokComposerModel({
      enabled: true, soul: "", driverKind: "grokAgent", effortLevels: ["high"], effort: "high", busy: false,
    })).toEqual({ show: true, fun: false, showThink: true, think: true, thinkDisabled: false });
    expect(grokComposerModel({
      enabled: true, soul: GROK_FUN_BLOCK, driverKind: "grokAgent", effortLevels: ["low"], busy: true,
    })).toEqual({ show: true, fun: true, showThink: false, think: undefined, thinkDisabled: true });
    expect(grokComposerModel({ enabled: false, soul: "", driverKind: "grokAgent", busy: false }).show).toBe(false);
  });

  it("writes or removes the fun paragraph, and toggles high effort", () => {
    expect(grokFunToggle("")).toEqual({ kind: "update", soul: GROK_FUN_BLOCK });
    expect(grokFunToggle(GROK_FUN_BLOCK)).toEqual({ kind: "update", soul: "" });
    expect(grokFunToggle("Be brief.", "Be brief.".length)).toEqual({ kind: "tooLong" });
    const selection = { instanceId: "grok", model: "grok", effort: "low" as const };
    expect(grokThinkSelection(selection, false)).toEqual({ instanceId: "grok", model: "grok", effort: "high" });
    expect(grokThinkSelection({ ...selection, effort: "high" }, false)).toEqual({ instanceId: "grok", model: "grok" });
    expect(grokThinkSelection(selection, true)).toBeNull();
  });
});
