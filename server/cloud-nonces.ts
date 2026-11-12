import { createHash } from "node:crypto";
import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type NonceClaim = "accepted" | "stale_request" | "replayed_request" | "busy";
export interface CloudNonceStore {
  claim(scope: string, nonce: string, now: number, signedAt: number, skewMs: number, limit: number): NonceClaim;
}

const SCHEMA = [
  ["table", "cloud_nonce_clock", "CREATE TABLE cloud_nonce_clock (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL)"],
  ["table", "cloud_nonces", "CREATE TABLE cloud_nonces (scope TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(scope, hash))"],
  ["index", "cloud_nonces_expiry", "CREATE INDEX cloud_nonces_expiry ON cloud_nonces(expires)"],
];

export class PersistentCloudNonces implements CloudNonceStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    // Missing state is indistinguishable from first install, so initialization cannot reject preexisting valid signatures.
    let fresh = path === ":memory:";
    if (!fresh) {
      try {
        closeSync(openSync(path, "wx", 0o600));
        fresh = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const db = new DatabaseSync(path, { timeout: 100 });
    try {
      if (path !== ":memory:") chmodSync(path, 0o600);
      db.exec("PRAGMA synchronous = FULL");
      if (fresh) db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE cloud_nonce_clock (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL);
        INSERT INTO cloud_nonce_clock VALUES (1, 0);
        CREATE TABLE cloud_nonces (scope TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(scope, hash));
        CREATE INDEX cloud_nonces_expiry ON cloud_nonces(expires);
        COMMIT;
      `);
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
      const schema = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all() as Array<{ type: string; name: string; sql: string }>;
      const normalized = (sql: string) => sql.replace(/\s+/g, "").toLowerCase();
      if (version.user_version !== 0 || schema.length !== SCHEMA.length || schema.some((entry, index) =>
        entry.type !== SCHEMA[index][0] || entry.name !== SCHEMA[index][1] || normalized(entry.sql) !== normalized(SCHEMA[index][2]))) {
        throw new Error("invalid nonce schema");
      }
      const row = db.prepare("SELECT at FROM cloud_nonce_clock WHERE id = 1").get() as { at: number } | undefined;
      if (!row || !Number.isSafeInteger(row.at) || row.at < 0) throw new Error("invalid nonce clock");
      db.prepare("SELECT scope, hash, expires FROM cloud_nonces LIMIT 1").get();
      this.db = db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  claim(scope: string, nonce: string, now: number, signedAt: number, skewMs: number, limit: number): NonceClaim {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(signedAt) || !Number.isSafeInteger(skewMs) || !Number.isSafeInteger(limit)) return "busy";
    const hash = createHash("sha256").update(nonce).digest("hex");
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const row = this.db.prepare("SELECT at FROM cloud_nonce_clock WHERE id = 1").get() as { at: number } | undefined;
      if (!row || !Number.isSafeInteger(row.at)) throw new Error("invalid nonce clock");
      const at = Math.max(row.at, now);
      this.db.prepare("UPDATE cloud_nonce_clock SET at = ? WHERE id = 1").run(at);
      this.db.prepare("DELETE FROM cloud_nonces WHERE expires < ?").run(at);
      let result: NonceClaim;
      if (Math.abs(at - signedAt) > skewMs) result = "stale_request";
      else if (this.db.prepare("SELECT 1 FROM cloud_nonces WHERE scope = ? AND hash = ?").get(scope, hash)) result = "replayed_request";
      else if (Number((this.db.prepare("SELECT COUNT(*) AS count FROM cloud_nonces WHERE scope = ?").get(scope) as { count: number }).count) >= limit) result = "busy";
      else {
        this.db.prepare("INSERT INTO cloud_nonces VALUES (?, ?, ?)").run(scope, hash, signedAt + skewMs);
        result = "accepted";
      }
      this.db.exec("COMMIT");
      return result;
    } catch {
      try { this.db.exec("ROLLBACK"); } catch {}
      return "busy";
    }
  }

  close(): void { this.db.close(); }
}
