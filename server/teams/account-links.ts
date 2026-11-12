import { createHash, randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER = /^[A-Za-z0-9_-]{16,128}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 10 * 60_000;

function guid(value: string): string {
  if (!GUID.test(value)) throw new Error("Invalid identity");
  return value.toLowerCase();
}

function member(value: string): string {
  if (!MEMBER.test(value)) throw new Error("Invalid identity");
  return value;
}

function digest(secret: string): string {
  return createHash("sha256").update(secret, "ascii").digest("hex");
}

export type TeamsAccountIdentity = { appId: string; tenantId: string; objectId: string };

/** `memberId` must be a verified local membership generation, not an email or a display name. */
export class TeamsAccountLinks {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private effectiveTime: number;
  private monotonicTime: number;

  constructor(path: string, now: () => number = Date.now, monotonic: () => number = () => performance.now()) {
    this.now = now;
    this.monotonic = monotonic;
    this.effectiveTime = now();
    this.monotonicTime = Math.floor(monotonic());
    if (!Number.isSafeInteger(this.effectiveTime) || this.effectiveTime < 0 || !Number.isSafeInteger(this.monotonicTime)) throw new Error("Invalid clock");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS challenges (
        hash TEXT PRIMARY KEY, app_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
        member_id TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS links (
        app_id TEXT NOT NULL, tenant_id TEXT NOT NULL, object_id TEXT NOT NULL,
        member_id TEXT NOT NULL, linked_at INTEGER NOT NULL,
        PRIMARY KEY (app_id, tenant_id, object_id),
        UNIQUE (app_id, tenant_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS link_clock (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), watermark INTEGER NOT NULL);
      INSERT OR IGNORE INTO link_clock VALUES (1, 0);
    `);
    const clock = this.db.prepare("SELECT watermark FROM link_clock WHERE singleton = 1").get() as { watermark: number };
    this.effectiveTime = Math.max(this.effectiveTime, clock.watermark);
  }

  issue(input: { appId: string; tenantId: string; memberId: string; ttlMs?: number }): { secret: string; expiresAt: number } {
    const app = guid(input.appId), tenant = guid(input.tenantId), owner = member(input.memberId);
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) throw new Error("Invalid challenge duration");
    let expiresAt = 0;
    const secret = randomBytes(32).toString("base64url");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = this.advanceClock();
      expiresAt = now + ttl;
      if (!Number.isSafeInteger(expiresAt)) throw new Error("Invalid clock");
      this.db.prepare("DELETE FROM challenges WHERE expires_at <= ? OR (app_id = ? AND tenant_id = ? AND member_id = ?)").run(now, app, tenant, owner);
      this.db.prepare("INSERT INTO challenges (hash, app_id, tenant_id, member_id, expires_at) VALUES (?, ?, ?, ?, ?)")
        .run(digest(secret), app, tenant, owner, expiresAt);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { secret, expiresAt };
  }

  /** Call only with independently verified Microsoft user identity, in a private conversation, before the secret is logged or sent to a model. Connector authentication alone does not verify the user. */
  consume(secret: string, identity: TeamsAccountIdentity, privateConversation: boolean, isCurrentMember: (memberId: string) => boolean): boolean {
    const app = guid(identity.appId), tenant = guid(identity.tenantId), object = guid(identity.objectId);
    if (!privateConversation || !SECRET.test(secret)) return false;
    const hash = digest(secret);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = this.advanceClock();
      const challenge = this.db.prepare("SELECT member_id, expires_at FROM challenges WHERE hash = ? AND app_id = ? AND tenant_id = ?")
        .get(hash, app, tenant) as { member_id: string; expires_at: number } | undefined;
      if (!challenge || challenge.expires_at <= now || !isCurrentMember(challenge.member_id)) {
        if (challenge) this.db.prepare("DELETE FROM challenges WHERE hash = ?").run(hash);
        this.db.exec("COMMIT");
        return false;
      }
      const prior = this.db.prepare("SELECT object_id, member_id FROM links WHERE app_id = ? AND tenant_id = ? AND (object_id = ? OR member_id = ?)")
        .all(app, tenant, object, challenge.member_id) as Array<{ object_id: string; member_id: string }>;
      if (prior.some(row => row.object_id !== object || row.member_id !== challenge.member_id)) {
        this.db.prepare("DELETE FROM challenges WHERE hash = ?").run(hash);
        this.db.exec("COMMIT");
        return false;
      }
      this.db.prepare("INSERT OR IGNORE INTO links (app_id, tenant_id, object_id, member_id, linked_at) VALUES (?, ?, ?, ?, ?)")
        .run(app, tenant, object, challenge.member_id, now);
      this.db.prepare("DELETE FROM challenges WHERE hash = ?").run(hash);
      this.db.exec("COMMIT");
      return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  resolve(identity: TeamsAccountIdentity, isCurrentMember: (memberId: string) => boolean): string | null {
    const row = this.db.prepare("SELECT member_id FROM links WHERE app_id = ? AND tenant_id = ? AND object_id = ?")
      .get(guid(identity.appId), guid(identity.tenantId), guid(identity.objectId)) as { member_id: string } | undefined;
    return row && isCurrentMember(row.member_id) ? row.member_id : null;
  }

  revoke(appId: string, tenantId: string, memberId: string): void {
    const app = guid(appId), tenant = guid(tenantId), owner = member(memberId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM challenges WHERE app_id = ? AND tenant_id = ? AND member_id = ?").run(app, tenant, owner);
      this.db.prepare("DELETE FROM links WHERE app_id = ? AND tenant_id = ? AND member_id = ?").run(app, tenant, owner);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private advanceClock(): number {
    const wall = this.now(), monotonic = Math.floor(this.monotonic());
    const elapsed = monotonic - this.monotonicTime;
    if (!Number.isSafeInteger(wall) || wall < 0 || !Number.isSafeInteger(elapsed) || elapsed < 0) throw new Error("Invalid clock");
    const row = this.db.prepare("SELECT watermark FROM link_clock WHERE singleton = 1").get() as { watermark: number };
    const effective = Math.max(wall, Math.max(this.effectiveTime, row.watermark) + elapsed);
    if (!Number.isSafeInteger(effective)) throw new Error("Invalid clock");
    this.db.prepare("UPDATE link_clock SET watermark = ? WHERE singleton = 1").run(effective);
    this.effectiveTime = effective;
    this.monotonicTime = monotonic;
    return effective;
  }

  close(): void { this.db.close(); }
}
