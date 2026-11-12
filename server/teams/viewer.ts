import type { TeamsHostPerson } from "./host.ts";

export function teamsViewer(person: TeamsHostPerson): { kind: "all" | "member"; email: string } {
  return { kind: person.admin ? "all" : "member", email: person.email };
}
