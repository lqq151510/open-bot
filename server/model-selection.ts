import { isEffortLevel } from "../shared/wire.ts";
import type { ServerErrorBody } from "../shared/server-text.ts";
import { isModelVariant, type ModelSelection } from "./contracts.ts";
import type { ProviderRegistry } from "./harness/registry.ts";
import type { hostedModelPolicy } from "./hosted-models.ts";
import { userError } from "./user-errors.ts";

function unavailableInstanceMessage(instanceId: string, reason?: string): string {
  return `model instance "${instanceId}" is unavailable${reason ? `: ${reason}` : ""}`;
}

export function modelSelectionChecks({ registry, hostedModels, providerInstancesChanging }: {
  registry: Pick<ProviderRegistry, "get" | "entries">;
  hostedModels: ReturnType<typeof hostedModelPolicy>;
  providerInstancesChanging: ReadonlySet<string>;
}) {
  const missingInstanceMessage = (instanceId: string) => unavailableInstanceMessage(
    instanceId,
    registry.entries().find((entry) => entry.instanceId === instanceId)?.shadow?.reason,
  );

  function checkedModelSelection(
    raw: unknown,
    current?: { selection: ModelSelection; busy: boolean },
    requireAvailableModel = false,
  ): { ok: true; selection: ModelSelection } | ({ ok: false; status: number } & ServerErrorBody) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, status: 400, error: "modelSelection must be an object" };
    }
    const value = raw as { instanceId?: unknown; model?: unknown; effort?: unknown; variant?: unknown };
    if (typeof value.instanceId !== "string" || !value.instanceId.trim()) {
      return { ok: false, status: 400, error: "modelSelection.instanceId is required" };
    }
    if (typeof value.model !== "string" || !value.model.trim()) {
      return { ok: false, status: 400, error: "modelSelection.model is required" };
    }
    const selection: ModelSelection = {
      instanceId: value.instanceId.trim(),
      model: value.model.trim(),
    };
    if (hostedModels && !hostedModels.allows(selection)) return { ok: false, status: 400, error: hostedModels.error() };
    if (value.effort !== undefined) {
      if (!isEffortLevel(value.effort)) {
        return { ok: false, status: 400, error: `effort "${String(value.effort)}" is not recognized` };
      }
      selection.effort = value.effort;
    }
    if (value.variant !== undefined) {
      if (!isModelVariant(value.variant)) {
        return { ok: false, status: 400, error: "variant must be a non-empty model variant ID" };
      }
      if (value.effort !== undefined) {
        return { ok: false, status: 400, error: "choose either a model variant or an effort level" };
      }
      selection.variant = value.variant;
    }
    const modelChanged = current && (selection.instanceId !== current.selection.instanceId || selection.model !== current.selection.model);
    if (current?.busy && modelChanged) {
      return { ok: false, status: 409, ...userError("serverError.model.botBusy") };
    }
    const target = registry.get(selection.instanceId);
    if (providerInstancesChanging.has(selection.instanceId)) {
      return { ok: false, status: 409, ...userError("serverError.model.accountUpdating") };
    }
    // Free-form model ids: custom engines accept ids outside their catalog, and some drivers learn the catalog only at turn start.
    if (requireAvailableModel) {
      if (!target) {
        return { ok: false, status: 400, error: missingInstanceMessage(selection.instanceId) };
      }
      const offered =
        selection.model === target.models.default ||
        target.models.options.some((option) => option.id === selection.model);
      if (!offered) {
        return {
          ok: false,
          status: 400,
          error: `model "${selection.model}" is not offered by instance "${selection.instanceId}"`,
        };
      }
    }
    const allowed: readonly string[] = target?.adapter.capabilities.effortLevels ?? [];
    if (target && selection.effort !== undefined && !allowed.includes(selection.effort)) {
      return { ok: false, status: 400, error: `effort "${selection.effort}" is not offered by this bot's engine` };
    }
    if (target && selection.variant !== undefined && !target.adapter.capabilities.modelVariants) {
      return { ok: false, status: 400, error: "model variants are not offered by this bot's engine" };
    }
    return { ok: true, selection };
  }

  /** Why an explicitly chosen model's instance cannot run now, or null; a missing instance says so without a reason. */
  async function unavailableModelRefusal(instanceId: string): Promise<string | null> {
    const instance = registry.get(instanceId);
    if (!instance) return missingInstanceMessage(instanceId);
    const snapshot = await instance.snapshot();
    return snapshot.state === "unavailable" ? unavailableInstanceMessage(instanceId, snapshot.reason) : null;
  }

  return { checkedModelSelection, unavailableModelRefusal };
}
