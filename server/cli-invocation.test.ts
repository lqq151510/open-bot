import { describe, expect, it } from "vitest";

import { cliCommand, cliPrefix } from "./cli-invocation.ts";

describe("cliPrefix", () => {
  it("prints commands the way the CLI was started", () => {
    expect(cliPrefix({}, "/home/me/.npm/_npx/1a2b/node_modules/openbot/dist-server/openbot.js")).toBe("npx openbot");
    expect(cliPrefix({ npm_command: "exec" }, "/repo/node_modules/vitest/vitest.mjs"), "another tool run by npx").toBe("openbot");
    expect(cliPrefix({ npm_lifecycle_event: "omb" }, "/repo/server/openbot.ts")).toBe("pnpm omb");
    expect(cliPrefix({ OMB_CLI_PREFIX: "docker compose exec omb openbot" }, "/app/dist-server/openbot.js")).toBe("docker compose exec omb openbot");
    expect(cliPrefix({}, "/usr/lib/node_modules/openbot/dist-server/openbot.js")).toBe("openbot");
    expect(cliCommand("pair", {}, "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\9\\node_modules\\openbot\\x.js")).toBe("npx openbot pair");
  });
});
