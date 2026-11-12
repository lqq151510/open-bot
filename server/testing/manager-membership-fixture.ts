import { randomUUID } from "node:crypto";

export function managerMembershipFixture() {
  const people = new Map<string, { membershipId: string; sessions: Set<string> }>();
  const address = (email: string) => email.trim().toLowerCase();
  return {
    seen(email: string, _role: string, verified = false, sessionId?: string) {
      if (!verified || !sessionId) return;
      const key = address(email);
      const person = people.get(key) ?? { membershipId: randomUUID(), sessions: new Set<string>() };
      person.sessions.add(sessionId);
      people.set(key, person);
    },
    left(email: string) { people.delete(address(email)); },
    membershipId(email: string) { return people.get(address(email))?.membershipId ?? null; },
    isCurrentSession(email: string, sessionId: string) { return people.get(address(email))?.sessions.has(sessionId) ?? false; },
    managerCandidates() { return [...people].map(([email, person]) => ({ email, membershipId: person.membershipId })); },
  };
}
