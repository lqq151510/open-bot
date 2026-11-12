import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { TeamsReplyTarget } from "./outbound.ts";
import type { TeamsAccountIdentity } from "./account-links.ts";

export interface TeamsConversationKey {
  appId: string;
  tenantId: string;
  botId: string;
  botGeneration: string;
  memberId: string;
  conversationId: string;
}

function valid(values: readonly string[]): boolean {
  // eslint-disable-next-line no-control-regex
  return values.every((value) => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value));
}

export class TeamsConversationStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS conversations (
        app_id TEXT NOT NULL, tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, bot_generation TEXT NOT NULL,
        member_id TEXT NOT NULL, conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (app_id, tenant_id, bot_id, bot_generation, member_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS reply_targets (
        send_id TEXT PRIMARY KEY, target TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', identity TEXT
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(reply_targets)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "state")) this.db.exec("ALTER TABLE reply_targets ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'");
    if (!columns.some((column) => column.name === "identity")) this.db.exec("ALTER TABLE reply_targets ADD COLUMN identity TEXT");
  }

  threadFor(key: TeamsConversationKey): string | null {
    const values = [key.appId, key.tenantId, key.botId, key.botGeneration, key.memberId, key.conversationId];
    if (!valid(values)) return null;
    const row = this.db.prepare("SELECT thread_id FROM conversations WHERE app_id = ? AND tenant_id = ? AND bot_id = ? AND bot_generation = ? AND member_id = ? AND conversation_id = ?")
      .get(...values) as { thread_id: string } | undefined;
    return row?.thread_id ?? null;
  }

  bindThread(key: TeamsConversationKey, threadId: string): boolean {
    const values = [key.appId, key.tenantId, key.botId, key.botGeneration, key.memberId, key.conversationId, threadId];
    if (!valid(values)) return false;
    this.db.prepare("INSERT OR IGNORE INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?)").run(...values);
    return this.threadFor(key) === threadId;
  }

  bindReply(sendId: string, target: TeamsReplyTarget, identity: TeamsAccountIdentity, linkGeneration: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sendId) || !valid([target.appId, target.tenantId, target.botId, target.botGeneration,
      target.memberId, target.memberGeneration, target.conversationId, target.activityId, target.serviceUrl,
      identity.appId, identity.tenantId, identity.objectId, linkGeneration])) return false;
    const encoded = JSON.stringify(target), who = JSON.stringify({ identity, linkGeneration });
    this.db.prepare("INSERT OR IGNORE INTO reply_targets (send_id, target, identity) VALUES (?, ?, ?)").run(sendId, encoded, who);
    const row = this.db.prepare("SELECT target, identity FROM reply_targets WHERE send_id = ?").get(sendId);
    return row?.target === encoded && row.identity === who;
  }

  replyFor(sendId: string): TeamsReplyTarget | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sendId)) return null;
    const row = this.db.prepare("SELECT target FROM reply_targets WHERE send_id = ?").get(sendId) as { target: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.target) as TeamsReplyTarget; } catch { return null; }
  }

  replyIdentityFor(sendId: string): { identity: TeamsAccountIdentity; linkGeneration: string } | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sendId)) return null;
    const row = this.db.prepare("SELECT identity FROM reply_targets WHERE send_id = ?").get(sendId) as { identity: string | null } | undefined;
    if (!row?.identity) return null;
    try {
      const value = JSON.parse(row.identity) as { identity?: TeamsAccountIdentity; linkGeneration?: string };
      if (!value.identity || !value.linkGeneration || !valid([value.identity.appId, value.identity.tenantId, value.identity.objectId, value.linkGeneration])) return null;
      return { identity: value.identity, linkGeneration: value.linkGeneration };
    } catch { return null; }
  }

  claimReply(sendId: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sendId)) return false;
    return Number(this.db.prepare("UPDATE reply_targets SET state = 'sending' WHERE send_id = ? AND state = 'pending'").run(sendId).changes) === 1;
  }

  finishReply(sendId: string, state: "sent" | "unknown" | "unavailable"): void {
    this.db.prepare("UPDATE reply_targets SET state = ? WHERE send_id = ? AND state = 'sending'").run(state, sendId);
  }

  close(): void { this.db.close(); }
}
