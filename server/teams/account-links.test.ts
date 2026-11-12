import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsAccountLinks } from "./account-links.ts";

const appId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const otherTenant = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const objectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const otherObject = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const memberId = "local_member_generation_123";
const otherMember = "local_member_generation_456";
const identity = { appId, tenantId, objectId };
let dir: string;
let path: string;
let now: number;
let links: TeamsAccountLinks;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openbot-teams-links-"));
  path = join(dir, "links.db");
  now = 1_000_000;
  links = new TeamsAccountLinks(path, () => now);
});
afterEach(() => { links.close(); rmSync(dir, { recursive: true, force: true }); });

describe("Teams account linking", () => {
  it("links only in a private conversation and consumes the challenge exactly once", () => {
    const { secret } = links.issue({ appId, tenantId, memberId });
    expect(links.consume(secret, identity, false, () => true)).toBe(false);
    expect(links.consume(secret, identity, true, id => id === memberId)).toBe(true);
    expect(links.consume(secret, identity, true, () => true)).toBe(false);
    expect(links.resolve(identity, id => id === memberId)).toBe(memberId);
    expect(links.resolve(identity, () => false)).toBeNull();
  });

  it("stores no reusable challenge secret, persists links, and rejects expired challenges", () => {
    const { secret, expiresAt } = links.issue({ appId, tenantId, memberId, ttlMs: 100 });
    const inspect = new DatabaseSync(path, { readOnly: true });
    expect(JSON.stringify(inspect.prepare("SELECT * FROM challenges").all())).not.toContain(secret);
    inspect.close();
    now = expiresAt;
    expect(links.consume(secret, identity, true, () => true)).toBe(false);
    const fresh = links.issue({ appId, tenantId, memberId }).secret;
    expect(links.consume(fresh, identity, true, () => true)).toBe(true);
    links.close();
    links = new TeamsAccountLinks(path, () => now);
    expect(links.resolve(identity, () => true)).toBe(memberId);
  });

  it("does not extend a challenge when wall time moves backwards while running", () => {
    let monotonic = 0;
    links.close();
    links = new TeamsAccountLinks(path, () => now, () => monotonic);
    const secret = links.issue({ appId, tenantId, memberId, ttlMs: 100 }).secret;
    now -= 500;
    monotonic += 100;
    expect(links.consume(secret, identity, true, () => true)).toBe(false);
  });

  it("persists an observed high watermark across restart and other instances", () => {
    let monotonic = 0;
    links.close();
    links = new TeamsAccountLinks(path, () => now, () => monotonic);
    const secret = links.issue({ appId, tenantId, memberId, ttlMs: 100 }).secret;
    now += 101;
    const other = new TeamsAccountLinks(path, () => now, () => monotonic);
    try { other.issue({ appId, tenantId, memberId: otherMember }); } finally { other.close(); }
    links.close();
    now -= 500;
    links = new TeamsAccountLinks(path, () => now, () => monotonic);
    expect(links.consume(secret, identity, true, () => true)).toBe(false);
  });

  it("keeps monotonic time advancing when restart wall time is below the saved watermark", () => {
    let monotonic = 0;
    links.close();
    links = new TeamsAccountLinks(path, () => now, () => monotonic);
    const secret = links.issue({ appId, tenantId, memberId, ttlMs: 100 }).secret;
    links.close();
    now -= 500;
    links = new TeamsAccountLinks(path, () => now, () => monotonic);
    monotonic += 100;
    expect(links.consume(secret, identity, true, () => true)).toBe(false);
  });

  it("does not count elapsed time twice when two instances interleave", () => {
    let monotonic = 0;
    links.close();
    links = new TeamsAccountLinks(path, () => now, () => monotonic);
    const other = new TeamsAccountLinks(path, () => now, () => monotonic);
    try {
      const secret = links.issue({ appId, tenantId, memberId, ttlMs: 1000 }).secret;
      now += 600;
      monotonic += 600;
      other.issue({ appId, tenantId, memberId: otherMember });
      expect(links.consume(secret, identity, true, () => true)).toBe(true);
    } finally { other.close(); }
  });

  it("fails closed for a challenge from an earlier process without deleting the original", async () => {
    const secret = links.issue({ appId, tenantId, memberId }).secret;
    vi.resetModules();
    const { TeamsAccountLinks: NewProcessLinks } = await import("./account-links.ts");
    const restarted = new NewProcessLinks(path, () => now);
    try {
      expect(restarted.consume(secret, identity, true, () => true)).toBe(false);
      expect(links.consume(secret, identity, true, () => true)).toBe(true);
    } finally { restarted.close(); }
  });

  it("does not cross app or tenant boundaries and requires the local membership to remain current", () => {
    const { secret } = links.issue({ appId, tenantId, memberId });
    expect(links.consume(secret, { ...identity, tenantId: otherTenant }, true, () => true)).toBe(false);
    expect(links.consume(secret, identity, true, () => false)).toBe(false);
    expect(links.resolve(identity, () => true)).toBeNull();
    const current = links.issue({ appId, tenantId, memberId }).secret;
    expect(links.consume(current, identity, true, () => true)).toBe(true);
    expect(links.resolve({ ...identity, tenantId: otherTenant }, () => true)).toBeNull();
    expect(links.resolve(identity, () => false)).toBeNull();
  });

  it("refuses to reassign either account and revocation invalidates pending challenges", () => {
    expect(links.consume(links.issue({ appId, tenantId, memberId }).secret, identity, true, () => true)).toBe(true);
    expect(links.consume(links.issue({ appId, tenantId, memberId: otherMember }).secret, identity, true, () => true)).toBe(false);
    expect(links.consume(links.issue({ appId, tenantId, memberId }).secret, { ...identity, objectId: otherObject }, true, () => true)).toBe(false);
    const pending = links.issue({ appId, tenantId, memberId }).secret;
    links.revoke(appId, tenantId, memberId);
    expect(links.consume(pending, identity, true, () => true)).toBe(false);
    expect(links.resolve(identity, () => true)).toBeNull();
    expect(links.consume(links.issue({ appId, tenantId, memberId: otherMember }).secret, identity, true, () => true)).toBe(true);
  });

  it("rejects malformed identities and caps the challenge lifetime", () => {
    expect(() => links.issue({ appId, tenantId, memberId: "me@example.com" })).toThrow();
    expect(() => links.issue({ appId, tenantId, memberId, ttlMs: 600_001 })).toThrow();
    expect(() => links.resolve({ ...identity, objectId: "not-an-object-id" }, () => true)).toThrow();
  });
});
