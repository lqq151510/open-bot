import { describe, expect, it } from "vitest";
import { accountSkill, singleBotId, usesSharedComputer } from "./product-defaults.ts";

describe("product defaults", () => {
  it("treats a missing surface as the one shared computer", () => {
    expect(usesSharedComputer(undefined)).toBe(true);
    expect(usesSharedComputer(null)).toBe(true);
    expect(usesSharedComputer("  ")).toBe(true);
    expect(usesSharedComputer("local")).toBe(false);
    expect(usesSharedComputer("vm")).toBe(false);
    expect(usesSharedComputer("off")).toBe(false);
  });

  it("keeps an approved skill on the account", () => {
    expect(accountSkill("approved")).toBe(true);
    expect(accountSkill("disabled")).toBe(false);
  });

  it("accepts one bot id for memory and routines", () => {
    expect(singleBotId("bot-1")).toBe("bot-1");
    expect(singleBotId("  bot-1  ")).toBe("bot-1");
    expect(singleBotId("")).toBeNull();
    expect(singleBotId("a,b")).toBeNull();
    expect(singleBotId("a b")).toBeNull();
    expect(singleBotId(undefined)).toBeNull();
  });
});
