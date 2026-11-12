import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyVendorCandidate, verifyVendorPatch } from "./build-windows-browser-vendor.mjs";

const { values } = parseArgs({ options: {
  source: { type: "string" }, app: { type: "string" }, "release-version": { type: "string" },
} });
assert(values.source && values.app && values["release-version"], "Provide --source, --app, and --release-version");
const source = resolve(values.source);
const app = resolve(values.app);
const provenance = JSON.parse(readFileSync(join(source, "provenance.json"), "utf8"));
const bytes = readFileSync(join(source, provenance.executable.asset));
const patchBytes = readFileSync(join(source, "agent-browser-windows-stdio.patch"));
verifyVendorCandidate(provenance, bytes);
verifyVendorPatch(patchBytes);

const asset = `agent-browser-win32-x64-${provenance.version}.exe`;
const pinPath = join(app, "server/browser-engine-release.ts");
const pinSource = readFileSync(pinPath, "utf8");
const lineEnding = pinSource.includes("\r\n") ? "\r\n" : "\n";
const match = /  \[\r?\n    "win32-x64",[\s\S]*?\r?\n  \],/.exec(pinSource);
assert(match, "Could not locate the pinned Windows browser engine entry");
const oldEntry = match[0];
assert(oldEntry.includes('version: "0.36.0-omb.1"'), "Refusing to replace an unexpected Windows engine pin");
const newEntry = [
  "  [",
  '    "win32-x64",',
  "    {",
  `      target: "win32-x64", version: "${provenance.version}",`,
  `      asset: "${asset}",`,
  `      url: "https://github.com/lqq151510/open-bot/releases/download/v${values["release-version"]}/${asset}",`,
  `      sha256: "${provenance.executable.sha256}", bytes: ${provenance.executable.bytes},`,
  "    },",
  "  ],",
].join(lineEnding);
writeFileSync(pinPath, `${pinSource.slice(0, match.index)}${newEntry}${pinSource.slice(match.index + oldEntry.length)}`);

const archives = join(app, "dist-native/browser-archives");
mkdirSync(archives, { recursive: true });
copyFileSync(join(source, provenance.executable.asset), join(archives, asset));
const patch = spawnSync("git", ["diff", "--", "server/browser-engine-release.ts"], { cwd: app, encoding: "utf8" });
assert.equal(patch.status, 0, patch.stderr || "Could not capture the Windows engine pin patch");
assert(patch.stdout.includes("0.36.0-omb.1") && patch.stdout.includes(provenance.version), "Generated pin patch is incomplete");
writeFileSync(join(app, `OpenBot-v${values["release-version"]}-windows-browser-engine-pin.patch`), patch.stdout);
console.log(JSON.stringify({ version: provenance.version, asset, bytes: provenance.executable.bytes, sha256: provenance.executable.sha256 }));
