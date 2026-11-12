import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { PersistentCloudNonces } from "./cloud-nonces.ts";
import { cloudPairingSignature, createCloudRequestVerifier } from "./cloud-home.ts";

const dirs: string[] = [];
function path() {
  const dir = mkdtempSync(join(tmpdir(), "openbot-cloud-nonce-"));
  dirs.push(dir);
  return join(dir, "nonces.sqlite");
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("rejects a signed request after a verifier and database restart", () => {
  const file = path(), secret = "fixture-secret", timestamp = "1800000000", nonce = "fixture-nonce-0001", body = "{}";
  const input = { timestamp, nonce, body, method: "POST", target: "/api/cloud/pairing", signature: `v1=${cloudPairingSignature(secret, timestamp, nonce, body)}` };
  let db = new PersistentCloudNonces(file);
  expect(createCloudRequestVerifier({ secret, now: () => 1_800_000_000_000, nonceStore: db }).verify(input)).toEqual({ ok: true });
  db.close();
  db = new PersistentCloudNonces(file);
  expect(createCloudRequestVerifier({ secret, now: () => 1_800_000_000_000, nonceStore: db }).verify(input)).toMatchObject({ ok: false, error: "replayed_request" });
  expect(readFileSync(file).includes(Buffer.from(nonce))).toBe(false);
  db.close();
});

it("serializes claims across separate connections and maintains route scopes", () => {
  const file = path(), a = new PersistentCloudNonces(file), b = new PersistentCloudNonces(file);
  expect(a.claim("pairing", "nonce-123", 1000, 1000, 500, 2)).toBe("accepted");
  expect(b.claim("pairing", "nonce-123", 1000, 1000, 500, 2)).toBe("replayed_request");
  expect(b.claim("health", "nonce-123", 1000, 1000, 500, 2)).toBe("accepted");
  a.close(); b.close();
});

it("allows exactly one of two processes to claim the same nonce", async () => {
  const file = path(), seed = new PersistentCloudNonces(file);
  seed.close();
  const moduleUrl = pathToFileURL(join(process.cwd(), "server/cloud-nonces.ts")).href;
  const code = `import { PersistentCloudNonces } from ${JSON.stringify(moduleUrl)};
    const db = new PersistentCloudNonces(process.argv[1]);
    process.stdout.write('ready\\n');
    process.stdin.once('data', () => { process.stdout.write(db.claim('pairing','same',1000,1000,500,5)+'\\n'); db.close(); });`;
  const start = () => spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file], { stdio: ["pipe", "pipe", "pipe"] });
  const a = start(), b = start();
  const lines = (child: ChildProcessWithoutNullStreams) => {
    let buffer = "";
    const pending: Array<(line: string) => void> = [];
    const ready: string[] = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const next = pending.shift(); if (next) next(line); else ready.push(line);
      }
    });
    return () => ready.length ? Promise.resolve(ready.shift()!) : new Promise<string>((resolve) => pending.push(resolve));
  };
  const fromA = lines(a), fromB = lines(b);
  try {
    expect(await Promise.all([fromA(), fromB()])).toEqual(["ready", "ready"]);
    a.stdin.end("go"); b.stdin.end("go");
    expect((await Promise.all([fromA(), fromB()])).sort()).toEqual(["accepted", "replayed_request"]);
  } finally { a.kill(); b.kill(); }
}, 10_000);

it("does not revive an expired request after the wall clock moves backward", () => {
  const db = new PersistentCloudNonces(path());
  expect(db.claim("p", "n", 1000, 1000, 500, 3)).toBe("accepted");
  expect(db.claim("p", "next", 1600, 1600, 500, 3)).toBe("accepted");
  expect(db.claim("p", "n", 1000, 1000, 500, 3)).toBe("stale_request");
  db.close();
});

it("keeps a nonce through the inclusive timestamp boundary and fails closed when full", () => {
  const db = new PersistentCloudNonces(path());
  expect(db.claim("p", "n", 1000, 1500, 500, 1)).toBe("accepted");
  expect(db.claim("p", "another", 1500, 1500, 500, 1)).toBe("busy");
  expect(db.claim("p", "n", 2000, 1500, 500, 1)).toBe("replayed_request");
  expect(db.claim("p", "another", 2001, 2001, 500, 1)).toBe("accepted");
  db.close();
});

it("does not replace a corrupt database with an empty cache", () => {
  const file = path();
  writeFileSync(file, "corrupt fixture");
  expect(() => new PersistentCloudNonces(file)).toThrow();
  expect(readFileSync(file, "utf8")).toBe("corrupt fixture");
});

it("rejects an existing database truncated to zero bytes", () => {
  const file = path(), db = new PersistentCloudNonces(file);
  expect(db.claim("pairing", "nonce-123", 1000, 1000, 500, 3)).toBe("accepted");
  db.close();
  writeFileSync(file, "");
  expect(() => new PersistentCloudNonces(file)).toThrow();
  expect(readFileSync(file)).toHaveLength(0);
});

it("accepts the existing version-zero schema without changing its claims", () => {
  const file = path(), legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE IF NOT EXISTS cloud_nonce_clock (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL);
    INSERT OR IGNORE INTO cloud_nonce_clock VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS cloud_nonces (scope TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(scope, hash));
    CREATE INDEX IF NOT EXISTS cloud_nonces_expiry ON cloud_nonces(expires);`);
  legacy.close();
  const db = new PersistentCloudNonces(file);
  expect(db.claim("pairing", "nonce-123", 1000, 1000, 500, 3)).toBe("accepted");
  db.close();
  const reopened = new PersistentCloudNonces(file);
  expect(reopened.claim("pairing", "nonce-123", 1000, 1000, 500, 3)).toBe("replayed_request");
  reopened.close();
});

it("fails closed when an existing database loses its clock row", () => {
  const file = path(), db = new PersistentCloudNonces(file);
  db.close();
  const damaged = new DatabaseSync(file);
  damaged.exec("DELETE FROM cloud_nonce_clock");
  damaged.close();
  expect(() => new PersistentCloudNonces(file)).toThrow();
});

it.each(["DROP TABLE cloud_nonces", "DROP INDEX cloud_nonces_expiry", "PRAGMA user_version = 1"])("rejects an incompatible existing schema: %s", (damage) => {
  const file = path(), db = new PersistentCloudNonces(file);
  db.close();
  const damaged = new DatabaseSync(file);
  damaged.exec(damage);
  damaged.close();
  expect(() => new PersistentCloudNonces(file)).toThrow();
});

it("allows at most one initial claim when processes create the same database", async () => {
  const file = path(), moduleUrl = pathToFileURL(join(process.cwd(), "server/cloud-nonces.ts")).href;
  const code = `import { PersistentCloudNonces } from ${JSON.stringify(moduleUrl)};
    try { const db = new PersistentCloudNonces(process.argv[1]);
      process.stdout.write(db.claim('pairing','same',1000,1000,500,5)); db.close();
    } catch { process.stdout.write('busy'); }`;
  const run = () => promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file]);
  const outcomes = (await Promise.all([run(), run()])).map((result) => result.stdout);
  expect(outcomes.filter((result) => result === "accepted")).toHaveLength(1);
  expect(outcomes.every((result) => ["accepted", "busy", "replayed_request"].includes(result))).toBe(true);
  const db = new PersistentCloudNonces(file);
  expect(db.claim("pairing", "same", 1000, 1000, 500, 5)).toBe("replayed_request");
  db.close();
}, 10_000);

it("recovers when a process exits before publishing its initialized database", () => {
  const file = path(), moduleUrl = pathToFileURL(join(process.cwd(), "server/cloud-nonces.ts")).href;
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    fs.linkSync = () => process.exit(72); syncBuiltinESMExports();
    const { PersistentCloudNonces } = await import(${JSON.stringify(moduleUrl)});
    new PersistentCloudNonces(process.argv[1]);`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file]);
  expect(child.status).toBe(72);
  expect(existsSync(file)).toBe(false);
  const db = new PersistentCloudNonces(file);
  expect(db.claim("pairing", "same", 1000, 1000, 500, 5)).toBe("accepted");
  db.close();
});

it("never replaces a damaged database that appears while another process initializes", () => {
  const file = path(), moduleUrl = pathToFileURL(join(process.cwd(), "server/cloud-nonces.ts")).href;
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const link = fs.linkSync; fs.linkSync = (source, target) => { fs.writeFileSync(target, 'damaged'); link(source, target); };
    syncBuiltinESMExports(); const { PersistentCloudNonces } = await import(${JSON.stringify(moduleUrl)});
    try { new PersistentCloudNonces(process.argv[1]); process.exit(1); } catch { process.exit(0); }`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file]);
  expect(child.status).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("damaged");
});

it("fails closed and removes the temporary file if publication fails", () => {
  const file = path(), moduleUrl = pathToFileURL(join(process.cwd(), "server/cloud-nonces.ts")).href;
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    fs.linkSync = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    syncBuiltinESMExports(); const { PersistentCloudNonces } = await import(${JSON.stringify(moduleUrl)});
    try { new PersistentCloudNonces(process.argv[1]); process.exit(1); } catch { process.exit(0); }`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file]);
  expect(child.status).toBe(0);
  expect(existsSync(file)).toBe(false);
  expect(readdirSync(dirname(file))).toEqual([]);
});

it.skipIf(process.platform === "win32")("fails closed if the published directory cannot be synced", () => {
  const file = path(), moduleUrl = pathToFileURL(join(process.cwd(), "server/cloud-nonces.ts")).href;
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const sync = fs.fsyncSync; fs.fsyncSync = (fd) => { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('denied'), { code: 'EIO' }); sync(fd); };
    syncBuiltinESMExports(); const { PersistentCloudNonces } = await import(${JSON.stringify(moduleUrl)});
    try { new PersistentCloudNonces(process.argv[1]); process.exit(1); } catch { process.exit(0); }`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file]);
  expect(child.status).toBe(0);
  expect(existsSync(file)).toBe(true);
  const retry = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file]);
  expect(retry.status).toBe(0);
  const db = new PersistentCloudNonces(file);
  expect(db.claim("pairing", "same", 1000, 1000, 500, 5)).toBe("accepted");
  db.close();
});

it("fails closed when another process holds the write lock", () => {
  const file = path(), nonces = new PersistentCloudNonces(file), blocker = new DatabaseSync(file);
  blocker.exec("BEGIN IMMEDIATE");
  try {
    expect(nonces.claim("pairing", "nonce-123", 1000, 1000, 500, 1)).toBe("busy");
  } finally { blocker.exec("ROLLBACK"); blocker.close(); }
  expect(nonces.claim("pairing", "nonce-123", 1000, 1000, 500, 1)).toBe("accepted");
  nonces.close();
});
