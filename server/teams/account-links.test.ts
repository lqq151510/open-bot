import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
