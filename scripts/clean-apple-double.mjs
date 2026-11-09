#!/usr/bin/env node
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

// Prevent macOS from creating AppleDouble (._*) resource fork files during file operations
process.env.COPYFILE_DISABLE = "1";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".serena",
  "dist",
  "dist-electron",
  "dist-native",
  "dist-server",
  "release",
]);

export async function removeAppleDoubleFiles(dir) {
  let count = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const tasks = entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.name.startsWith("._")) {
        try {
          await unlink(fullPath);
          count++;
        } catch {
          // ignore unlink error
        }
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        count += await removeAppleDoubleFiles(fullPath);
      }
    });
    await Promise.all(tasks);
  } catch {
    // ignore directory read error
  }
  return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const start = Date.now();
  const root = process.argv[2] || process.cwd();
  const cleaned = await removeAppleDoubleFiles(root);
  // Clean root .git/._* if present
  try {
    const gitEntries = await readdir(join(root, ".git"), { withFileTypes: true });
    await Promise.all(
      gitEntries
        .filter((e) => e.name.startsWith("._"))
        .map((e) => unlink(join(root, ".git", e.name)).catch(() => {})),
    );
  } catch {}
  console.log(`Cleaned ${cleaned} AppleDouble (._*) files in ${Date.now() - start}ms.`);
}
