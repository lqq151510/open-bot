import { createHash } from "node:crypto";
import { closeSync, linkSync, lstatSync, mkdtempSync, openSync, readdirSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ownerEmail } from "../shared/bot-owner.ts";

const grantSchema = z.object({ botId: z.string().regex(/^[\w-]{1,128}$/), botGeneration: z.string().uuid(), email: z.string().min(3).max(254), membershipId: z.string().uuid() });
const fileSchema = z.object({ version: z.literal(3), grants: z.array(grantSchema).max(10_000), revisions: z.record(z.string().regex(/^[\w-]{1,128}$/), z.number().int().nonnegative().safe()).refine((value) => Object.keys(value).length <= 10_000) });
type Grant = z.infer<typeof grantSchema>;
type State = z.infer<typeof fileSchema>;
type Dependencies = { file: string; botGeneration(botId: string): string | null; membershipId(email: string): string | null; isCurrentSession(email: string, sessionId: string): boolean };

export class BotManagersError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function createBotManagers(deps: Dependencies) {
  const unavailable = () => new BotManagersError("Manager grants are unavailable.", 503);
  const generation = (botId: string): string => {
    const value = deps.botGeneration(botId);
    if (!value || !z.string().uuid().safeParse(value).success) throw new BotManagersError("No such bot or trusted bot identity.", 404);
    return value;
  };
  const records = (grants: Grant[], botId: string, botGeneration: string) =>
    grants.filter((entry) => entry.botId === botId && entry.botGeneration === botGeneration).sort((a, b) => a.email.localeCompare(b.email));
  const sequence = (state: State, botId: string) => Object.hasOwn(state.revisions, botId) ? state.revisions[botId]! : 0;
  const revision = (state: State, botId: string, botGeneration: string) =>
    createHash("sha256").update(JSON.stringify({ botGeneration, sequence: sequence(state, botId), grants: records(state.grants, botId, botGeneration).map((record) => ({ ...record, current: deps.membershipId(record.email) })) })).digest("hex");
  const changed = (state: State, botId: string, grants: Grant[]): State => {
    const nextSequence = sequence(state, botId) + 1;
    if (!Number.isSafeInteger(nextSequence) || (!Object.hasOwn(state.revisions, botId) && Object.keys(state.revisions).length >= 10_000)) throw unavailable();
    return { version: 3, grants, revisions: { ...state.revisions, [botId]: nextSequence } };
  };

  const initialize = (path: string): void => {
    const dir = mkdtempSync(join(dirname(path), ".bot-managers-init-"));
    const staged = join(dir, "state.sqlite");
    let db: DatabaseSync | undefined;
    try {
      const fd = openSync(staged, "wx", 0o600);
      closeSync(fd);
      db = new DatabaseSync(staged, { timeout: 1000 });
      db.exec("BEGIN IMMEDIATE");
      db.exec("CREATE TABLE manager_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)");
      db.prepare("INSERT INTO manager_state (id, payload) VALUES (1, ?)").run(JSON.stringify({ version: 3, grants: [], revisions: {} }));
      db.exec("COMMIT");
      db.close();
      db = undefined;
      try { linkSync(staged, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally {
      db?.close();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };

  const cleanupPublishedLinks = (path: string): void => {
    const target = lstatSync(path);
    if (target.nlink <= 1) return;
    if (!target.ino) throw unavailable();
    for (const entry of readdirSync(dirname(path), { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(".bot-managers-init-")) continue;
      const dir = join(dirname(path), entry.name);
      const staged = join(dir, "state.sqlite");
      try {
        const source = lstatSync(staged);
        if (!source.isFile() || !source.ino || source.ino !== target.ino || source.dev !== target.dev) continue;
        unlinkSync(staged);
        try { rmdirSync(dir); } catch {}
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (lstatSync(path).nlink > 1) throw unavailable();
  };

  const transact = <T>(write: boolean, operation: (state: State) => { value: T; next?: State }): T => {
    let db: DatabaseSync | undefined;
    let inTransaction = false;
    try {
      try {
        lstatSync(deps.file);
        throw unavailable();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const path = `${deps.file}.sqlite`;
      try { lstatSync(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        initialize(path);
      }
      if (!lstatSync(path).isFile()) throw unavailable();
      cleanupPublishedLinks(path);
      db = new DatabaseSync(path, { timeout: 1000 });
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
      inTransaction = true;
      const row = db.prepare("SELECT payload FROM manager_state WHERE id = 1").get() as { payload?: unknown } | undefined;
      if (!row || typeof row.payload !== "string") throw unavailable();
      const parsed = fileSchema.safeParse(JSON.parse(row.payload));
      if (!parsed.success || !parsed.data.grants.every((entry) => entry.email === ownerEmail(entry.email)) ||
          new Set(parsed.data.grants.map((entry) => `${entry.botId}\u0000${entry.email}`)).size !== parsed.data.grants.length) throw unavailable();
      const result = operation(parsed.data);
      if (result.next) {
        if (!write) throw unavailable();
        db.prepare("UPDATE manager_state SET payload = ? WHERE id = 1").run(JSON.stringify(result.next));
      }
      db.exec("COMMIT");
      inTransaction = false;
      return result.value;
    } catch (error) {
      if (inTransaction) { try { db?.exec("ROLLBACK"); } catch {} }
      if (error instanceof BotManagersError) throw error;
      throw unavailable();
    } finally {
      db?.close();
    }
  };

  return {
    list(botId: string): { emails: string[]; revision: string } {
      return transact(false, (state) => {
        const botGeneration = generation(botId);
        return { value: { emails: records(state.grants, botId, botGeneration).filter((entry) => deps.membershipId(entry.email) === entry.membershipId).map((entry) => entry.email), revision: revision(state, botId, botGeneration) } };
      });
    },
    discard(botId: string, botGeneration: string): void {
      if (!z.string().uuid().safeParse(botGeneration).success) throw new BotManagersError("Invalid bot identity.", 400);
      transact(true, (state) => {
        const next = state.grants.filter((entry) => entry.botId !== botId || entry.botGeneration !== botGeneration);
        return { value: undefined, ...(next.length === state.grants.length ? {} : { next: changed(state, botId, next) }) };
      });
    },
    has(botId: string, email: string, sessionId: string): boolean {
      try {
        return transact(false, (state) => {
          const botGeneration = generation(botId);
          const address = ownerEmail(email);
          const membership = deps.membershipId(address);
          return { value: deps.isCurrentSession(address, sessionId) && membership !== null && state.grants.some((entry) => entry.botId === botId && entry.botGeneration === botGeneration && entry.email === address && entry.membershipId === membership) };
        });
      } catch { return false; }
    },
    replace(botId: string, members: Array<{ email: string; membershipId: string }>, expectedRevision: string): { emails: string[]; revision: string } {
      return transact(true, (state) => {
        const botGeneration = generation(botId);
        if (revision(state, botId, botGeneration) !== expectedRevision) throw new BotManagersError("Manager grants changed. Reload and try again.", 409);
        if (members.length > 100) throw new BotManagersError("Too many managers.", 400);
        const nextForBot = members.map((member) => {
          const email = ownerEmail(member.email);
          const parsed = grantSchema.safeParse({ botId, botGeneration, email, membershipId: member.membershipId });
          if (!parsed.success || deps.membershipId(email) !== parsed.data.membershipId) throw new BotManagersError("Choose a current verified team member.", 400);
          return parsed.data;
        }).sort((a, b) => a.email.localeCompare(b.email));
        if (new Set(nextForBot.map((entry) => entry.email)).size !== nextForBot.length) throw new BotManagersError("A manager may only be selected once.", 400);
        const next = [...state.grants.filter((entry) => entry.botId !== botId), ...nextForBot];
        if (next.length > 10_000) throw new BotManagersError("Too many manager grants.", 400);
        const updated = changed(state, botId, next);
        return { value: { emails: nextForBot.map((entry) => entry.email), revision: revision(updated, botId, botGeneration) }, next: updated };
      });
    },
  };
}
