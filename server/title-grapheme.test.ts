import { expect, it } from "vitest";
import { threadTitleFrom, titleFromMessage } from "./store.ts";

it("keeps emoji intact in generated and supplied thread titles", () => {
  const emoji = "👩🏽‍💻";
  expect(titleFromMessage(`${"a".repeat(46)}${emoji}tail`)).toBe(`${"a".repeat(46)}…`);
  expect(threadTitleFrom(`${"a".repeat(79)}${emoji}tail`)).toBe("a".repeat(79));
});
