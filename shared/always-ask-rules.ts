export type AlwaysAskRuleScope = "personal" | "team";

export interface AlwaysAskRule {
  id: string;
  text: string;
}

export interface AlwaysAskRulesResponse {
  rules: readonly AlwaysAskRule[];
  personalRules: readonly AlwaysAskRule[];
  teamRules: readonly AlwaysAskRule[];
  canEditPersonal: boolean;
  canEditTeam: boolean;
  semanticReview: boolean;
}
