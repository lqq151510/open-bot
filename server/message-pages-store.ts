import type { Message } from "./store.ts";
import type { ThreadCache } from "./thread-cache.ts";
import * as mdb from "./message-db.ts";

export function readMessagesTail(threads: ThreadCache, threadId: string, legacyFile: string, limit: number): { messages: Message[]; hasMore: boolean; activeLeafId: string | null } {
  let state = threads.get(threadId);
  if (!state) {
    const tail = mdb.readThreadTail(threadId, legacyFile, limit);
    const legacyRows = tail.hasMore !== undefined && tail.messages.some((m) => m.parentId === undefined);
    if (tail.hasMore !== true || legacyRows) {
      state = threads.load(threadId, legacyRows ? mdb.readThread(threadId, legacyFile) : tail);
    } else {
      return {
        messages: tail.messages,
        hasMore: tail.hasMore,
        activeLeafId: tail.activeLeafId ?? tail.messages.at(-1)?.id ?? null,
      };
    }
  }
  const { messages, activeLeafId } = state;
  const start = Math.max(0, messages.length - limit);
  return { messages: messages.slice(start), hasMore: start > 0, activeLeafId };
}

export function readMessagesBefore(threads: ThreadCache, threadId: string, legacyFile: string, before: string, limit: number): { messages: Message[]; hasMore: boolean; activeLeafId: string | null } | null {
  let state = threads.get(threadId);
  if (!state) {
    const page = mdb.readThreadBefore(threadId, legacyFile, before, limit);
    if (!page) return null;
    if (page.hasMore === undefined || page.messages.some((m) => m.parentId === undefined)) {
      state = threads.load(threadId, page.hasMore === undefined ? page : mdb.readThread(threadId, legacyFile));
    } else {
      return { messages: page.messages, hasMore: page.hasMore, activeLeafId: page.activeLeafId };
    }
  }
  const stop = state.messages.findIndex((m) => m.id === before);
  if (stop < 0) return null;
  const start = Math.max(0, stop - limit);
  return { messages: state.messages.slice(start, stop), hasMore: start > 0, activeLeafId: state.activeLeafId };
}
