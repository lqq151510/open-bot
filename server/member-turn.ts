// Without `model`, Hermes hits OpenRouter with HTTP 401, Qwen dies with Internal error and Grok silently runs its cloud default.
import { isModelVariant, type EffortLevel, type ModelSelection } from "./contracts.ts";
import { isEffortLevel, THINK_EFFORT } from "../shared/wire.ts";

export function assertModelVariantSupported(
  selection: Pick<ModelSelection, "variant" | "effort">,
  capabilities: { modelVariants?: boolean },
): void {
  if (selection.variant !== undefined &&
      (!isModelVariant(selection.variant) || !capabilities.modelVariants || selection.effort !== undefined)) {
    throw Object.assign(
      new Error("the saved model variant cannot be applied by this AI — choose a variant in model settings"),
      { status: 409, code: "unsupported_model_variant" },
    );
  }
}

export function readTurnEffort(value: unknown): EffortLevel | undefined {
  return isEffortLevel(value) ? value : undefined;
}

/** A Think request uses `THINK_EFFORT` only when this engine lists it and the turn is not also sending a variant. */
export function thinkEffortForTurn(
  requested: EffortLevel | undefined,
  levels: readonly EffortLevel[] | undefined,
  variant: string | undefined,
): EffortLevel | undefined {
  if (requested !== THINK_EFFORT || variant !== undefined || !levels?.includes(THINK_EFFORT)) return undefined;
  return THINK_EFFORT;
}

export function memberTurnSelection(selection: ModelSelection): {
  model: string;
  effort?: EffortLevel;
  variant?: string;
} {
  return {
    model: selection.model,
    ...(selection.effort ? { effort: selection.effort } : {}),
    ...(selection.variant !== undefined ? { variant: selection.variant } : {}),
  };
}
