import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = Boolean(binary) || process.env.OMB_UI_E2E === "1";

(enabled ? it : it.skip)("creates a bot from the simple sidebar form with its chosen appearance", async () => {
  let child: ChildProcess | undefined;
  try {
    let stdout = "", stderr = "";
    let info!: { ui: string };
    child = spawn(process.execPath, ["--experimental-strip-types", join(root, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", chunk => { stdout += String(chunk); });
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    await expect.poll(() => {
      if (child!.exitCode !== null) throw new Error(stderr);
      try { info = JSON.parse(stdout); return Boolean(info.ui); } catch { return false; }
    }, { timeout: 180_000 }).toBe(true);
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async (code: string) => (await ui("eval", "--js", code)).result;
    const bots = () => evaluate("fetch('/api/bots?messages=0').then(r=>r.json()).then(x=>x.bots.map(b=>({name:b.name,color:b.color,body:b.mascotBody,crop:b.avatarCrop})))") as Promise<Array<Record<string, string>>>;
    await evaluate("localStorage.setItem('omb-advanced-mode','0'); window.dispatchEvent(new StorageEvent('storage',{key:'omb-advanced-mode'})); true");
    const before = await bots();
    await ui("click", "--name", "New or share");
    await ui("click", "--name", "New bot");
    await expect.poll(() => evaluate("document.querySelector('[data-quick-bot-identity] input')?.value")).toBe("");
    expect(await bots()).toHaveLength(before.length);
    expect(await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(x=>x.textContent.trim()==='Create bot')?.disabled")).toBe(true);
    await ui("type", "--name", "Name", "--text", "Fixture Replica");
    await ui("click", "--name", "Use the Star body");
    await ui("click", "--name", "Use blue mascot color");
    await ui("click", "--name", "Bot settings");
    await ui("click", "--name", "Back");
    expect(await evaluate("document.querySelector('[data-quick-bot-identity] input')?.value")).toBe("Fixture Replica");
    await ui("click", "--name", "Create bot");
    await expect.poll(async () => (await bots()).find(bot => bot.name === "Fixture Replica"), { timeout: 15_000 })
      .toMatchObject({ name: "Fixture Replica", color: "blue", body: "star", crop: "mascot" });
  } finally {
    await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
  }
}, 240_000);
