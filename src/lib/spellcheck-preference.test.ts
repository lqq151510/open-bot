// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SPELLCHECK_KEY, readSpellcheck, setSpellcheck } from "./spellcheck-preference";

describe("spellcheck preference", () => {
  it("starts on, matching the platform default", () => {
    localStorage.clear();
    expect(readSpellcheck()).toBe(true);
  });

  it("remembers a turned-off choice", () => {
    setSpellcheck(false);
    expect(localStorage.getItem(SPELLCHECK_KEY)).toBe("0");
    expect(readSpellcheck()).toBe(false);
    setSpellcheck(true);
    expect(readSpellcheck()).toBe(true);
  });
});
