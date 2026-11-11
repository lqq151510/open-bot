/** A shared computer is held by one bot. Other members can see that and take over; the hold is not theirs. */
export interface PanelHold {
  held: boolean;
  heldByOther: boolean;
}

export function panelHoldFor(input: {
  botId: string;
  key: string;
  computerHeld: boolean;
  holderBotId: string | null;
}): PanelHold {
  if (!input.computerHeld || !input.key.startsWith("computer_")) {
    return { held: input.computerHeld, heldByOther: false };
  }
  if (input.holderBotId === input.botId) return { held: true, heldByOther: false };
  return { held: false, heldByOther: true };
}

export function showsYourControl(hold: { held: boolean; heldByOther?: boolean }): boolean {
  return hold.held === true && hold.heldByOther !== true;
}

export async function handBackSharedHold(
  hold: { held: boolean; heldByOther?: boolean },
  release: () => Promise<unknown>,
): Promise<boolean> {
  if (!showsYourControl(hold)) return false;
  await release();
  return true;
}

export function projectPanelHold<T extends { held: boolean }>(
  botId: string,
  key: string,
  holderBotId: string | null,
  body: T,
): T & { heldByOther?: true } {
  const view = panelHoldFor({ botId, key, computerHeld: body.held, holderBotId });
  if (!view.heldByOther) return { ...body, held: view.held };
  return { ...body, held: false, heldByOther: true };
}
