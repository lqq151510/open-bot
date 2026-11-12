import { createHash, randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface TeamsActivityKey {
  appId: string;
  tenantId: string;
  conversationId: string;
  activityId: string;
}

export type ActivityClaim =
  | { state: "claimed"; sendId: string; lease: string }
  | { state: "busy" | "done" | "conflict" | "full" | "expired" | "unverified"; sendId: string };

/** Verifies an authenticated proof binding the activity identity, body and immutable deadline. A Connector JWT or an activity timestamp alone is not such a proof. */
export type ReplayDeadlineVerifier = (key: TeamsActivityKey, rawBody: Uint8Array, proof: Uint8Array) => number | null;

function token(value: string): string {
  if (!value || value.length > 2048 || [...value].some(char => { const code = char.codePointAt(0)!; return code < 32 || code === 127; })) throw new Error("Invalid activity identity");
  return value;
}

function eventId(key: TeamsActivityKey): string {
  const app = token(key.appId), tenant = token(key.tenantId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(app) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) throw new Error("Invalid activity identity");
  return createHash("sha256").update(JSON.stringify([app.toLowerCase(), tenant.toLowerCase(), token(key.conversationId), token(key.activityId)])).digest("base64url");
}

/** The caller must use sendId with a durable idempotent send; a lease alone cannot make a side effect exactly once. */
export class TeamsActivityInbox {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly verifyDeadline?: ReplayDeadlineVerifier;

  constructor(path: string, now: () => number = Date.now, maxEntries = 100_000, verifyDeadline?: ReplayDeadlineVerifier) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new Error("Invalid inbox capacity");
    this.now = now;
    this.maxEntries = maxEntries;
    this.verifyDeadline = verifyDeadline;
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL,
        lease TEXT NOT NULL, lease_until INTEGER NOT NULL, expires_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS replay_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        watermark INTEGER NOT NULL, requires_proof INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO replay_state VALUES (1, 0, 0);
    `);
    const columns = this.db.prepare("PRAGMA table_info(activities)").all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === "expires_at")) this.db.exec("ALTER TABLE activities ADD COLUMN expires_at INTEGER");
    if (verifyDeadline) this.db.prepare("UPDATE replay_state SET requires_proof = 1 WHERE singleton = 1").run();
  }

  claim(key: TeamsActivityKey, rawBody: Uint8Array, leaseMs = 60_000, proof?: Uint8Array): ActivityClaim {
    const id = eventId(key);
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000 || rawBody.byteLength > 1_000_000 || (proof?.byteLength ?? 0) > 65_536) throw new Error("Invalid activity");
    const expires = this.verifyDeadline && proof ? this.verifyDeadline(key, rawBody, proof) : null;
    if (this.verifyDeadline && (!Number.isSafeInteger(expires) || expires === null || expires <= 0)) return { state: "unverified", sendId: id };
    const body = createHash("sha256").update(rawBody).digest("hex"), now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid clock");
    const lease = randomBytes(32).toString("base64url");
    const leaseHash = createHash("sha256").update(lease, "ascii").digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.db.prepare("SELECT watermark, requires_proof FROM replay_state WHERE singleton = 1").get() as
        { watermark: number; requires_proof: number };
      if (replay.requires_proof && !this.verifyDeadline) { this.db.exec("COMMIT"); return { state: "unverified", sendId: id }; }
      const watermark = Math.max(replay.watermark, now);
      this.db.prepare("UPDATE replay_state SET watermark = ? WHERE singleton = 1").run(watermark);
      this.db.prepare("DELETE FROM activities WHERE expires_at IS NOT NULL AND expires_at <= ? AND (state = 'done' OR lease_until <= ?)").run(watermark, watermark);
      if (expires !== null && expires <= watermark) { this.db.exec("COMMIT"); return { state: "expired", sendId: id }; }
      const row = this.db.prepare("SELECT payload_hash, state, lease_until, expires_at FROM activities WHERE id = ?").get(id) as
        { payload_hash: string; state: string; lease_until: number; expires_at: number | null } | undefined;
      if (row && (row.payload_hash !== body || (row.expires_at !== null && row.expires_at !== expires))) {
        this.db.exec("COMMIT"); return { state: "conflict", sendId: id };
      }
      if (row?.state === "done") { this.db.exec("COMMIT"); return { state: "done", sendId: id }; }
      if (row && row.lease_until > watermark) { this.db.exec("COMMIT"); return { state: "busy", sendId: id }; }
      if (!row) {
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM activities").get() as { count: number };
        if (count.count >= this.maxEntries) { this.db.exec("COMMIT"); return { state: "full", sendId: id }; }
        this.db.prepare("INSERT INTO activities (id, payload_hash, state, lease, lease_until, expires_at) VALUES (?, ?, 'pending', ?, ?, ?)")
          .run(id, body, leaseHash, watermark + leaseMs, expires);
      } else {
        this.db.prepare("UPDATE activities SET lease = ?, lease_until = ? WHERE id = ?").run(leaseHash, watermark + leaseMs, id);
      }
      this.db.exec("COMMIT");
      return { state: "claimed", sendId: id, lease };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  complete(sendId: string, lease: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sendId) || !/^[A-Za-z0-9_-]{43}$/.test(lease)) return false;
    const result = this.db.prepare("UPDATE activities SET state = 'done', lease = '', lease_until = 0 WHERE id = ? AND state = 'pending' AND lease = ?")
      .run(sendId, createHash("sha256").update(lease, "ascii").digest("hex"));
    return Number(result.changes) === 1;
  }

  close(): void { this.db.close(); }
}
