import type { SendTurnInput } from "../contracts.ts";

export const PI_TOOL_REVIEW_TITLE = "OpenBot tool review";

type ToolRuleTurn = Pick<SendTurnInput, "approvalRulesActive" | "approvalRuleForTool">;
type ToolRuleAction = Parameters<NonNullable<ToolRuleTurn["approvalRuleForTool"]>>[0];

export async function firstToolRequiringApproval(turn: ToolRuleTurn, action: ToolRuleAction, alias?: string): Promise<string | undefined> {
  if (alias && await toolRuleRequiresApproval(turn, { tool: alias, command: action.command })) return alias;
  return await toolRuleRequiresApproval(turn, action) ? action.tool : undefined;
}

export async function toolRuleRequiresApproval(turn: ToolRuleTurn, action: ToolRuleAction): Promise<boolean> {
  try {
    if (turn.approvalRulesActive?.() !== true) return false;
    return await turn.approvalRuleForTool?.(action) ?? true;
  } catch {
    return true;
  }
}
