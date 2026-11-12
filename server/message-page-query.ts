import type { StatementSync } from "node:sqlite";
import type { ThreadRows, ThreadTailRows } from "./message-db.ts";
import type { Message } from "./store.ts";

interface MessagePageQueryDeps {
  prepared(sql: string): StatementSync;
  importLegacy(threadId: string, legacyFile: string): ThreadRows;
  rowToMessage(row: { json: string }): Message;
}

export function createMessagePageQueries({ prepared, importLegacy, rowToMessage }: MessagePageQueryDeps) {
  const ACTIVE_LEAF = "SELECT active_leaf_id FROM thread_state WHERE thread_id = ?";
  function readThreadTail(threadId: string, legacyFile: string, limit: number): ThreadTailRows {
    const rows = prepared("SELECT json FROM messages WHERE thread_id = ? ORDER BY rowid DESC LIMIT ?").all(threadId, limit + 1) as Array<{ json: string }>;
    if (rows.length) {
      const hasMore = rows.length > limit;
      if (hasMore) rows.length = limit;
      rows.reverse();
      const state = prepared(ACTIVE_LEAF).get(threadId) as { active_leaf_id: string | null } | undefined;
      return { messages: rows.map(rowToMessage), activeLeafId: state?.active_leaf_id ?? null, hasMore };
    }
    return importLegacy(threadId, legacyFile);
  }

  function readThreadBefore(threadId: string, legacyFile: string, before: string, limit: number): ThreadTailRows | null {
    const cursor = prepared("SELECT rowid FROM messages WHERE thread_id = ? AND id = ?").get(threadId, before) as { rowid: number } | undefined;
    if (!cursor) {
      if (prepared("SELECT 1 FROM messages WHERE thread_id = ? LIMIT 1").get(threadId)) return null;
      const imported = importLegacy(threadId, legacyFile);
      return imported.messages.some((message) => message.id === before) ? imported : null;
    }
    const rows = prepared("SELECT json FROM messages WHERE thread_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?").all(threadId, cursor.rowid, limit + 1) as Array<{ json: string }>;
    const hasMore = rows.length > limit;
    if (hasMore) rows.length = limit;
    rows.reverse();
    const state = prepared(ACTIVE_LEAF).get(threadId) as { active_leaf_id: string | null } | undefined;
    const last = state?.active_leaf_id ? undefined : prepared("SELECT id FROM messages WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1").get(threadId) as { id: string } | undefined;
    return { messages: rows.map(rowToMessage), activeLeafId: state?.active_leaf_id || last?.id || null, hasMore };
  }

  return { readThreadTail, readThreadBefore };
}
