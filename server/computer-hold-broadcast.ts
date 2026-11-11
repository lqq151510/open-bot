import type { ComputerControl, ControlSnapshot } from "./computer-control.ts";
import { panelHoldFor, projectPanelHold } from "../shared/computer-hold-view.ts";

export { panelHoldFor, projectPanelHold };

/** One-way, fail-closed mirror into Electron: never send release, since a loopback caller can influence the server record. */
export function publishComputerControl(input: {
  key: string;
  snapshot: ControlSnapshot;
  holderBotId: string | null;
  memberBotIds: readonly string[];
  revision: Map<string, number>;
  desktop: (message: { type: "openbot:browser-control"; botId: string; held: true }) => void;
  broadcast: (frame: Record<string, unknown>) => void;
}): void {
  for (const botId of input.memberBotIds) {
    input.revision.set(botId, (input.revision.get(botId) ?? 0) + 1);
    const view = panelHoldFor({
      botId,
      key: input.key,
      computerHeld: input.snapshot.held,
      holderBotId: input.holderBotId,
    });
    if (input.snapshot.held && /^[A-Za-z0-9_-]{1,120}$/.test(botId)) {
      input.desktop({ type: "openbot:browser-control", botId, held: true });
    }
    const frame: Record<string, unknown> = {
      kind: "computer-control",
      botId,
      held: view.held,
      helpReason: input.snapshot.helpReason,
      ...(view.heldByOther ? { heldByOther: true } : {}),
      ...(input.snapshot.help ? { help: input.snapshot.help } : {}),
    };
    input.broadcast(frame);
  }
}

type ControlApi = Pick<ComputerControl, "snapshot" | "holder" | "take" | "release" | "acquireLease" | "releaseLease" | "ownsLease">;

export function answerBotComputerControl(
  control: ControlApi,
  botId: string,
  key: string,
  action: string,
  controlLeaseId?: string,
): unknown {
  if (action === "take" && controlLeaseId) {
    const result = control.acquireLease(key, controlLeaseId, botId);
    return projectPanelHold(botId, key, control.holder(key), { ...result.snapshot, owned: result.owned, acquired: result.acquired });
  }
  if (action === "release" && controlLeaseId) {
    const result = control.releaseLease(key, controlLeaseId);
    return projectPanelHold(botId, key, control.holder(key), { ...result.snapshot, released: result.released });
  }
  if (action === "check" && controlLeaseId) {
    return projectPanelHold(botId, key, control.holder(key), { ...control.snapshot(key), owned: control.ownsLease(key, controlLeaseId) });
  }
  if (action === "take") {
    const snapshot = control.take(key, botId);
    return projectPanelHold(botId, key, control.holder(key), snapshot);
  }
  if (action === "release") {
    const snapshot = control.release(key, botId);
    return projectPanelHold(botId, key, control.holder(key), snapshot);
  }
  return null;
}
