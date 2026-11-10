export function usesSharedComputer(computer: string | null | undefined): boolean {
  return computer == null || computer.trim() === "";
}

export function accountSkill(reviewState: string): boolean {
  return reviewState === "approved";
}

export function singleBotId(botId: string | null | undefined): string | null {
  if (typeof botId !== "string") return null;
  const id = botId.trim();
  if (!id || /[\s,]/.test(id)) return null;
  return id;
}
