import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.ts";
import type { copyToComputer } from "../cloud-computer-files.ts";
import { uploadMeetingPrivate } from "./meetings-host.ts";

describe("private meeting upload", () => {
  it.each(["ok", "wrong-path", "wrong-size", "failure"])("cleans its private file after %s", async (outcome) => {
    let tempDir = "";
    const content = '{"url":"fixture-password","token":"fixture-token"}';
    const target = "/home/user/.openbot-meet/m-12345678/config.tmp";
    const transfer: typeof copyToComputer = async (_cfg, _box, folder, args) => {
      tempDir = folder;
      const file = join(folder, args.from);
      expect(readFileSync(file, "utf8")).toBe(content);
      if (process.platform !== "win32") {
        expect(statSync(folder).mode & 0o777).toBe(0o700);
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
      if (outcome === "failure") throw new Error("fixture-password fixture-token signed-url");
      return { path: outcome === "wrong-path" ? "/tmp/other" : args.path, bytes: outcome === "wrong-size" ? 0 : Buffer.byteLength(content) };
    };
    const work = uploadMeetingPrivate({} as AppConfig, "fixture-box", target, content, transfer);
    if (outcome === "ok") await expect(work).resolves.toBeUndefined();
    else await expect(work).rejects.toThrow(/^Secure meeting upload failed\.$/);
    expect(tempDir).not.toBe("");
    expect(existsSync(tempDir)).toBe(false);
  });
});
