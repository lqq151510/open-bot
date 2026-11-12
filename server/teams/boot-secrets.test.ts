import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Teams boot secrets", () => {
  it("removes the credentials from the environment inherited by child processes", () => {
    const script = `import { BOOT_TEAMS_SECRETS } from "./server/teams/boot-secrets.ts";
      const { execFileSync } = await import("node:child_process");
      const child = execFileSync(process.execPath, ["-e", "process.stdout.write(String(Boolean(process.env.OMB_TEAMS_GATEWAY_KEY || process.env.OMB_TEAMS_CLIENT_SECRET)))"], { encoding: "utf8" });
      process.stdout.write(JSON.stringify({ captured: Boolean(BOOT_TEAMS_SECRETS.OMB_TEAMS_GATEWAY_KEY && BOOT_TEAMS_SECRETS.OMB_TEAMS_CLIENT_SECRET), child }));`;
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, OMB_TEAMS_GATEWAY_KEY: "fake-gateway-key", OMB_TEAMS_CLIENT_SECRET: "fake-client-secret" },
    });
    expect(JSON.parse(output)).toEqual({ captured: true, child: "false" });
  });
});
