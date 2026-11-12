import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DecisionRow } from "./decision-log.ts";
import { redactSecrets } from "./redact.ts";
import { teamMemoryAuditActor } from "./team-memory-audit-actor.ts";

const FILE = "team-memory-audit.db";

function open(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, FILE));
  chmodSync(join(dataDir, FILE), 0o600);
  db.exec("PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, at TEXT NOT NULL, row TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL)");
  return db;
}

export function recordTeamMemoryReview(dataDir: string, id: string, row: DecisionRow, cutoff: number): void {
  if (Date.parse(row.at) < cutoff) return;
  const db = open(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    const watermark = db.prepare("SELECT value FROM metadata WHERE key = ?").get("prunedBefore") as { value: number } | undefined;
    if (Date.parse(row.at) >= (watermark?.value ?? 0)) {
      if (row.source !== "user" || (row.decision !== "user-approved" && row.decision !== "user-denied")) throw new Error("invalid team memory review event");
      const actor = teamMemoryAuditActor(row.actor);
      const safe: DecisionRow = { at: row.at, threadId: row.threadId, ...(row.requestId ? { requestId: row.requestId } : {}), ...(row.botId ? { botId: row.botId } : {}), tool: "propose_team_memory", decision: row.decision, source: "user", ...(actor ? { actor } : {}) };
      const value = JSON.stringify(redactSecrets(safe));
      db.prepare("INSERT OR IGNORE INTO reviews (id, at, row) VALUES (?, ?, ?)").run(id, row.at, value);
      const existing = db.prepare("SELECT row FROM reviews WHERE id = ?").get(id) as { row: string } | undefined;
      if (existing?.row !== value) throw new Error("team memory review audit ID conflict");
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}

export function readTeamMemoryReviews(dataDir: string, from: number, to: number): DecisionRow[] {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("SELECT row FROM reviews WHERE at >= ? AND at <= ? ORDER BY at, id")
      .all(new Date(from).toISOString(), new Date(to).toISOString()) as Array<{ row: string }>;
    return rows.map(({ row }) => JSON.parse(row) as DecisionRow);
  } finally { db.close(); }
}

export function pruneTeamMemoryReviews(dataDir: string, cutoff: number): number {
  const db = open(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)").run("prunedBefore", cutoff);
    const watermark = (db.prepare("SELECT value FROM metadata WHERE key = ?").get("prunedBefore") as { value: number }).value;
    db.prepare("DELETE FROM reviews WHERE at < ?").run(new Date(watermark).toISOString());
    db.exec("COMMIT");
    return watermark;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
