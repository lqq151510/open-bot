import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const NAME_LIMIT = 120;

export function createMacComputerNameReader({ platform = process.platform, execute = run } = {}) {
  let pending;

  const read = async () => {
    try {
      const { stdout } = await execute("/usr/sbin/scutil", ["--get", "ComputerName"], {
        encoding: "utf8", timeout: 1_000, maxBuffer: 4_096,
      });
      const displayName = stdout
        .replace(/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/gu, " ")
        .replace(/(?![\u200c\u200d])\p{Cf}/gu, "")
        .trim();
      const bounded = [...displayName].slice(0, NAME_LIMIT).join("").trimEnd();
      return bounded.replace(/\p{Default_Ignorable_Code_Point}/gu, "").trim() ? bounded : null;
    } catch {
      return null;
    }
  };

  return () => {
    if (platform !== "darwin") return Promise.resolve(null);
    pending ??= read().finally(() => { pending = undefined; });
    return pending;
  };
}
