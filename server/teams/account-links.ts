import { createHash, randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER = /^[A-Za-z0-9_-]{16,128}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 10 * 60_000;
const PROCESS_EPOCH = randomBytes(32).toString("base64url");

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

  constructor(path: string, now: () => number = Date.now, monotonic: () => number = () => performance.now()) {
    this.now = now;
    this.monotonic = monotonic;
    const wall = now(), ticks = Math.floor(monotonic());
    if (!Number.isSafeInteger(wall) || wall < 0 || !Number.isSafeInteger(ticks) || ticks < 0) throw new Error("Invalid clock");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS challenges (
        hash TEXT PRIMARY KEY, app_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
        member_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
        issue_epoch TEXT, issued_monotonic INTEGER, expires_monotonic INTEGER
      );
      CREATE TABLE IF NOT EXISTS links (
        app_id TEXT NOT NULL, tenant_id TEXT NOT NULL, object_id TEXT NOT NULL,
        member_id TEXT NOT NULL, linked_at INTEGER NOT NULL, link_generation TEXT,
        PRIMARY KEY (app_id, tenant_id, object_id),
        UNIQUE (app_id, tenant_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS link_clock (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), watermark INTEGER NOT NULL);
      INSERT OR IGNORE INTO link_clock VALUES (1, 0);
    `);
    const linkColumns = this.db.prepare("PRAGMA table_info(links)").all() as Array<{ name: string }>;
    if (!linkColumns.some((column) => column.name === "link_generation")) this.db.exec("ALTER TABLE links ADD COLUMN link_generation TEXT");
    this.db.exec("UPDATE links SET link_generation = lower(hex(randomblob(16))) WHERE link_generation IS NULL");
    const columns = this.db.prepare("PRAGMA table_info(challenges)").all() as Array<{ name: string }>;
    for (const name of ["issue_epoch", "issued_monotonic", "expires_monotonic"]) {
      if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE challenges ADD COLUMN ${name} ${name === "issue_epoch" ? "TEXT" : "INTEGER"}`);
    }
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
      const issuedMonotonic = Math.floor(this.monotonic());
      const expiresMonotonic = issuedMonotonic + ttl;
      expiresAt = now + ttl;
      if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(issuedMonotonic) || issuedMonotonic < 0 || !Number.isSafeInteger(expiresMonotonic)) throw new Error("Invalid clock");
      this.db.prepare("DELETE FROM challenges WHERE expires_at <= ? OR (app_id = ? AND tenant_id = ? AND member_id = ?)").run(now, app, tenant, owner);
      this.db.prepare("INSERT INTO challenges (hash, app_id, tenant_id, member_id, expires_at, issue_epoch, issued_monotonic, expires_monotonic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(digest(secret), app, tenant, owner, expiresAt, PROCESS_EPOCH, issuedMonotonic, expiresMonotonic);
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
      const challenge = this.db.prepare("SELECT member_id, expires_at, issue_epoch, issued_monotonic, expires_monotonic FROM challenges WHERE hash = ? AND app_id = ? AND tenant_id = ?")
        .get(hash, app, tenant) as { member_id: string; expires_at: number; issue_epoch: string | null; issued_monotonic: number | null; expires_monotonic: number | null } | undefined;
      if (!challenge || challenge.issue_epoch !== PROCESS_EPOCH || challenge.issued_monotonic === null || challenge.expires_monotonic === null) {
        this.db.exec("COMMIT");
        return false;
      }
      const monotonic = Math.floor(this.monotonic());
      if (!Number.isSafeInteger(monotonic) || monotonic < 0 || monotonic < challenge.issued_monotonic || challenge.expires_monotonic <= monotonic || challenge.expires_at <= now || !isCurrentMember(challenge.member_id)) {
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
      this.db.prepare("INSERT OR IGNORE INTO links (app_id, tenant_id, object_id, member_id, linked_at, link_generation) VALUES (?, ?, ?, ?, ?, ?)")
        .run(app, tenant, object, challenge.member_id, now, randomBytes(16).toString("hex"));
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

  generation(identity: TeamsAccountIdentity, memberId: string, isCurrentMember: (memberId: string) => boolean): string | null {
    const row = this.db.prepare("SELECT member_id, link_generation FROM links WHERE app_id = ? AND tenant_id = ? AND object_id = ?")
      .get(guid(identity.appId), guid(identity.tenantId), guid(identity.objectId)) as { member_id: string; link_generation: string | null } | undefined;
    return row?.member_id === memberId && isCurrentMember(memberId) ? row.link_generation : null;
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
    const wall = this.now();
    if (!Number.isSafeInteger(wall) || wall < 0) throw new Error("Invalid clock");
    const row = this.db.prepare("SELECT watermark FROM link_clock WHERE singleton = 1").get() as { watermark: number };
    const effective = Math.max(wall, row.watermark);
    this.db.prepare("UPDATE link_clock SET watermark = ? WHERE singleton = 1").run(effective);
    return effective;
  }

  close(): void { this.db.close(); }
}
