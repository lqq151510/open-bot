// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ACCENT, ACCENT_KEY, applyAccent, bootAccent, readAccent } from "./accent";

describe("accent preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-skin");
    document.documentElement.removeAttribute("style");
  });

  it("defaults to the reference black", () => {
    expect(DEFAULT_ACCENT).toBe("ink");
    expect(readAccent()).toBe("ink");
  });

  it("ignores an unknown saved value", () => {
    localStorage.setItem(ACCENT_KEY, "chartreuse");
    expect(readAccent()).toBe("ink");
  });

  it("paints an accent and keeps it for the next boot", () => {
    applyAccent("green");
    expect(localStorage.getItem(ACCENT_KEY)).toBe("green");
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#1a9c62");
    expect(bootAccent()).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#1a9c62");
  });

  it("uses the dark variant on a dark skin", () => {
    document.documentElement.dataset.skin = "midnight";
    applyAccent("ink");
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#f5f5f5");
  });

  it("does not write storage when booting an unset preference", () => {
    bootAccent();
    expect(localStorage.getItem(ACCENT_KEY)).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#111111");
  });
});
