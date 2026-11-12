import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ownerEmail } from "../shared/bot-owner.ts";
import { writeFileAtomic } from "./atomic.ts";

const grantSchema = z.object({ botId: z.string().regex(/^[\w-]{1,128}$/), email: z.string().min(3).max(254), membershipId: z.string().uuid() });
const fileSchema = z.object({ version: z.literal(1), grants: z.array(grantSchema).max(10_000) });
type Grant = z.infer<typeof grantSchema>;
type Dependencies = { file: string; botExists(botId: string): boolean; membershipId(email: string): string | null; isCurrentSession(email: string, sessionId: string): boolean };

export class BotManagersError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function createBotManagers(deps: Dependencies) {
  let grants: Grant[] = [];
  let readable = true;
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(deps.file, "utf8")));
    if (parsed.success && parsed.data.grants.every((entry) => entry.email === ownerEmail(entry.email)) && new Set(parsed.data.grants.map((entry) => `${entry.botId}\u0000${entry.email}`)).size === parsed.data.grants.length) grants = parsed.data.grants;
    else readable = false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") readable = false;
  }
  const save = (next: Grant[]) => {
    try { writeFileAtomic(deps.file, `${JSON.stringify({ version: 1, grants: next })}\n`, { mode: 0o600 }); }
    catch (error) { readable = false; throw error; }
    grants = next;
  };
  if (readable) {
    const existing = grants.filter((entry) => deps.botExists(entry.botId));
    if (existing.length !== grants.length) { try { save(existing); } catch { readable = false; } }
  }
  const available = () => { if (!readable) throw new BotManagersError("Manager grants are unavailable.", 503); };
  const records = (botId: string) => grants.filter((entry) => entry.botId === botId).sort((a, b) => a.email.localeCompare(b.email));
  const revision = (botId: string) => createHash("sha256").update(JSON.stringify(records(botId).map((record) => ({ ...record, current: deps.membershipId(record.email) })))).digest("hex");
  const exists = (botId: string) => { if (!deps.botExists(botId)) throw new BotManagersError("No such bot.", 404); };
  return {
    list(botId: string): { emails: string[]; revision: string } {
      available();
      exists(botId);
      return { emails: records(botId).filter((entry) => deps.membershipId(entry.email) === entry.membershipId).map((entry) => entry.email), revision: revision(botId) };
    },
    discard(botId: string): void {
      available();
      const next = grants.filter((entry) => entry.botId !== botId);
      if (next.length !== grants.length) save(next);
    },
    has(botId: string, email: string, sessionId: string): boolean {
      if (!readable || !deps.botExists(botId)) return false;
      const address = ownerEmail(email);
      if (!deps.isCurrentSession(address, sessionId)) return false;
      const membership = deps.membershipId(address);
      return membership !== null && grants.some((entry) => entry.botId === botId && entry.email === address && entry.membershipId === membership);
    },
    replace(botId: string, members: Array<{ email: string; membershipId: string }>, expectedRevision: string): { emails: string[]; revision: string } {
      available();
      exists(botId);
      if (revision(botId) !== expectedRevision) throw new BotManagersError("Manager grants changed. Reload and try again.", 409);
      if (members.length > 100) throw new BotManagersError("Too many managers.", 400);
      const nextForBot = members.map((member) => {
        const email = ownerEmail(member.email);
        const parsed = grantSchema.safeParse({ botId, email, membershipId: member.membershipId });
        if (!parsed.success || deps.membershipId(email) !== parsed.data.membershipId) throw new BotManagersError("Choose a current verified team member.", 400);
        return parsed.data;
      }).sort((a, b) => a.email.localeCompare(b.email));
      if (new Set(nextForBot.map((entry) => entry.email)).size !== nextForBot.length) throw new BotManagersError("A manager may only be selected once.", 400);
      const next = [...grants.filter((entry) => entry.botId !== botId), ...nextForBot];
      if (next.length > 10_000) throw new BotManagersError("Too many manager grants.", 400);
      save(next);
      return { emails: nextForBot.map((entry) => entry.email), revision: revision(botId) };
    },
  };
}
