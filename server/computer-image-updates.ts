import type { ComputerImageStatus, ComputerImageUpdate, ComputerImageUpdates } from "../shared/computer-image-updates.ts";
import { listManagedBoats, type ManagedBoatOwner } from "./boat.ts";
import { localVmMaxInstances, localVmMode, type AppConfig } from "./config.ts";
import {
  containerComputerStatus,
  containerRuntimeStatus,
  perBotLocalVmTarget,
  poolLocalVmTarget,
  SHARED_LOCAL_VM_TARGET,
  type LocalVmTarget,
} from "./container-computer.ts";
import { listManagedVpsComputers } from "./vps-computer.ts";
import { vpsAliasesInPlay } from "./vps-hosts.ts";

interface ImageProbeResult {
  computers: ComputerImageUpdate[];
  unverified: boolean;
}

interface ImageProbeOptions {
  cfg: AppConfig;
  bots: Array<{ id: string; name: string; vpsAlias?: string }>;
  owners: ManagedBoatOwner[];
  localBusy(target: LocalVmTarget): boolean;
}

function imageStatus(matches: boolean | null | undefined, busy: boolean): ComputerImageStatus {
  if (matches == null) return "waiting";
  if (matches) return "current";
  return busy ? "busy" : "ready";
}

function localTargets({ cfg, bots }: ImageProbeOptions): Array<{ target: LocalVmTarget; name: string }> {
  const mode = localVmMode(cfg);
  if (mode === "per-bot") return bots.map((bot) => ({ target: perBotLocalVmTarget(bot.id), name: bot.name }));
  if (mode === "pool") return Array.from({ length: localVmMaxInstances(cfg) }, (_, seat) => {
    const target = poolLocalVmTarget(seat);
    return { target, name: target.label };
  });
  return [{ target: SHARED_LOCAL_VM_TARGET, name: SHARED_LOCAL_VM_TARGET.label }];
}

async function localImageUpdates(options: ImageProbeOptions): Promise<ImageProbeResult> {
  const runtimeStatus = await containerRuntimeStatus();
  const result: ImageProbeResult = {
    computers: [],
    unverified: Boolean(runtimeStatus.runtime && !runtimeStatus.daemonUp),
  };
  if (!runtimeStatus.daemonUp) return result;
  const targets = localTargets(options);
  for (let offset = 0; offset < targets.length; offset += 8) {
    const inspected = await Promise.all(targets.slice(offset, offset + 8).map(async ({ target, name }) => ({
      target,
      name,
      status: await containerComputerStatus(undefined, undefined, target, { inspectOnly: true, runtimeStatus }),
    })));
    for (const { target, name, status } of inspected) {
      if (status.container_inspection_failed) {
        result.unverified = true;
        continue;
      }
      if (!status.managed || status.container === "missing") continue;
      const identityMatches = status.image_identity_matches ?? (status.image_pin_differs ? false : null);
      result.computers.push({
        id: target.key,
        name,
        provider: "local-vm",
        status: imageStatus(identityMatches, options.localBusy(target)),
      });
    }
  }
  return result;
}

async function vpsImageUpdates({ cfg, bots, owners }: ImageProbeOptions): Promise<ImageProbeResult> {
  const inventory = await listManagedVpsComputers(cfg, owners, undefined, vpsAliasesInPlay(cfg, bots), { inspectImage: true });
  return {
    computers: inventory.instances.map((computer) => ({
      id: `${computer.vpsAlias}:${computer.name}`,
      name: computer.ownerName ?? computer.name,
      provider: "vps",
      status: imageStatus(computer.imageMatches, computer.inUse),
    })),
    unverified: inventory.configured && !inventory.available,
  };
}

async function boatImageUpdates({ cfg, owners }: ImageProbeOptions): Promise<ImageProbeResult> {
  const inventory = await listManagedBoats(cfg, owners, { adoptLegacy: false });
  return {
    computers: inventory.instances.map((computer) => ({
      id: computer.boxId,
      name: computer.ownerName ?? computer.name,
      provider: "boat",
      status: "waiting",
    })),
    unverified: inventory.configured && !inventory.available,
  };
}

export async function readComputerImageUpdates(options: ImageProbeOptions): Promise<ComputerImageUpdates> {
  const checked = await Promise.allSettled([localImageUpdates(options), vpsImageUpdates(options), boatImageUpdates(options)]);
  const computers = checked.flatMap((check) => check.status === "fulfilled" ? check.value.computers : []);
  const unverified = checked.some((check) => check.status === "rejected" || check.value.unverified) ||
    computers.some((computer) => computer.status === "waiting");
  const status = computers.some((computer) => computer.status === "busy") ? "busy"
    : computers.some((computer) => computer.status === "ready") ? "ready"
    : computers.length === 0 ? "unavailable"
    : unverified ? "waiting" : "current";
  return { status, computers, unverified };
}
