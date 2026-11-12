import { describe, expect, it, vi } from "vitest";
import { sliceGraphemesByUnits } from "./grapheme.ts";

describe("sliceGraphemesByUnits", () => {
  it("keeps only complete graphemes within the UTF-16 limit", () => {
    for (const cluster of ["😀", "👩🏽‍💻", "🇨🇳", "e\u0301"]) {
      expect(sliceGraphemesByUnits(`a${cluster}b`, cluster.length)).toBe("a");
      expect(sliceGraphemesByUnits(`a${cluster}b`, cluster.length + 1)).toBe(`a${cluster}`);
    }
  });

  it("loads safely without Segmenter and never splits an unrecognized grapheme", async () => {
    const native = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    vi.stubGlobal("Intl", Object.create(Intl, { Segmenter: { value: undefined } }));
    vi.resetModules();
    try {
      const fallback = await import("./grapheme.ts");
      expect(fallback.sliceGraphemesByUnits("hello world", 5)).toBe("hello");
      expect(fallback.sliceGraphemesByUnits(`${"a".repeat(140)}中`, 139)).toBe("a".repeat(139));
      expect(fallback.sliceGraphemesByUnits("中文".repeat(100), 139)).toBe("中文".repeat(69) + "中");
      expect(fallback.sliceGraphemesByUnits("hello 👩🏽‍💻 world", 7)).toBe("hello");
      expect(fallback.sliceGraphemesByUnits("ab\u0301cd", 2)).toBe("a");
      expect(fallback.sliceGraphemesByUnits("👩🏽‍💻中文后续", 8)).toBe("👩🏽‍💻中");
      expect(fallback.sliceGraphemesByUnits("👩🏽‍💻", 10)).toBe("👩🏽‍💻");
      for (const text of ["中文abc👩🏽‍💻e\u0301中文", "a🇨🇳bc", "中\u{e0100}文abc", "a\u200db中文", "a\r\nb中文"]) {
        const boundaries = new Set([0, ...Array.from(native.segment(text), ({ index, segment }) => index + segment.length)]);
        for (let limit = 0; limit < text.length; limit++) {
          const clipped = fallback.sliceGraphemesByUnits(text, limit);
          expect(clipped.length).toBeLessThanOrEqual(limit);
          expect(boundaries.has(clipped.length), `${JSON.stringify(text)} at ${limit}`).toBe(true);
        }
      }
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("does not exceed the limit for an oversized grapheme", () => {
    const cluster = `a${"\u0301".repeat(200)}`;
    expect(sliceGraphemesByUnits(`${cluster}b`, 80)).toBe("");
    expect(sliceGraphemesByUnits("hello", 0)).toBe("");
  });
});
