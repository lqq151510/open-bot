import { describe, expect, it } from "vitest";
import { teamsViewer } from "./viewer.ts";

describe("Teams viewer", () => {
  it("does not elevate an owner role when the current session lacks admin scope", () => {
    expect(teamsViewer({ email: "owner@example.test", role: "owner", admin: false }))
      .toEqual({ kind: "member", email: "owner@example.test" });
    expect(teamsViewer({ email: "owner@example.test", role: "owner", admin: true }))
      .toEqual({ kind: "all", email: "owner@example.test" });
  });
});
