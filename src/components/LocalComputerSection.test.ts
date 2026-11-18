// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const storeFixture = vi.hoisted(() => ({ config: null as unknown }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: storeFixture.config }, dispatch: vi.fn() }) };
});

import {
  LocalCloudComputerCard,
  OtherRemoteDesktopsDisclosure,
  resolveHeroStateKind,
  shouldExpandRemoteDesktops,
  type LocalVmStatus,
} from "./LocalCloudComputerCard";
import {
  CloudComputersCard,
  LocalComputerSection,
  LocalVmIdleTimeoutSetting,
  LocalVmInventoryCard,
  cloudComputerActionPlan,
  cloudComputerInventoryState,
  confirmComputerAction,
  localVmInventoryState,
  parseLocalVmIdleTimeoutMinutes,
  reconcileCloudInventoryPayload,
  perBotLocalVmDeletePlan,
  reconcileCloudInventorySnapshot,
  vpsComputerRemovePlan,
  vpsComputerInventoryState,
  vpsComputerShortId,
  type CloudComputerInventoryInstance,
  type LocalVmInventoryInstance,
  type VpsComputerInventoryInstance,
} from "./LocalComputerSection";
import { computerInventoryRequest } from "@/lib/computer-requests";
import { VpsComputersCard } from "./VpsComputersCard";

const cloudVm: LocalVmInventoryInstance = {
  botId: "cloud-bot",
  name: "Research",
  destination: "cloud",
  container: "running",
  ready: true,
  managed: true,
  problem: null,
  inUse: false,
};

const ownedCloudComputer: CloudComputerInventoryInstance = {
  boxId: "provider-id-must-not-render",
  name: "ogb-current0-a1b2c3",
  state: "ready",
  ownerBotId: "current-owner",
  ownerName: "Research",
  orphaned: false,
  inUse: false,
};

afterEach(() => setLocale("en"));

describe("computer inventory request wiring", () => {
  it("keeps every mount and refresh request observation-only", () => {
    const controller = new AbortController();
    const requests = ([
      ["status", "/api/local-computer"],
      ["local-vms", "/api/local-computer/instances"],
      ["cloud", "/api/computers/boxes"],
      ["vps", "/api/computers/vps"],
    ] as const).map(([kind, expectedUrl]) => ({
      expectedUrl,
      request: computerInventoryRequest(kind, controller.signal),
    }));

    for (const { expectedUrl, request: [url, init] } of requests) {
      expect(url).toBe(expectedUrl);
      expect(init).toEqual({ signal: controller.signal });
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
    }
  });

  it("does not expose a destructive request when confirmation is cancelled", () => {
    const confirm = vi.fn(() => false);
    const request = confirmComputerAction(perBotLocalVmDeletePlan(cloudVm), confirm);

    expect(request).toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      "Delete Research's private desktop? Its durable folder and website sign-ins are kept. Apps installed inside the desktop and files outside the durable folder are deleted.",
    );
  });

  it("builds the exact confirmed Local VM, Boat, and VPS lifecycle requests", () => {
    const confirm = vi.fn(() => true);
    const local = confirmComputerAction(perBotLocalVmDeletePlan(cloudVm), confirm);
    const cloudDelete = confirmComputerAction(cloudComputerActionPlan("delete", ownedCloudComputer), confirm);
    const cloudSleep = confirmComputerAction(cloudComputerActionPlan("sleep", ownedCloudComputer), confirm);
    const vpsName = "openbot-vps-current-123456abcdef";
    const vps = confirmComputerAction(vpsComputerRemovePlan({
      name: vpsName,
      state: "running",
      vpsAlias: "alpha-vps",
      ownerBotId: "current-owner",
      ownerName: "Research",
      orphaned: false,
      inUse: false,
    }), confirm);

    expect(local).toEqual([
      "/api/bots/cloud-bot/local-computer/remove",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ]);
    expect(cloudDelete).toEqual([
      "/api/computers/boxes/provider-id-must-not-render/delete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: ownedCloudComputer.name }),
      },
    ]);
    expect(cloudSleep).toEqual([
      "/api/computers/boxes/provider-id-must-not-render/sleep",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ]);
    expect(vps).toEqual([
      `/api/computers/vps/${vpsName}/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: vpsName, alias: "alpha-vps" }),
      },
    ]);
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});

describe("Local VM inventory UI", () => {
  it("shows capacity, current destinations, health, and an in-use deletion guard", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [
        cloudVm,
        {
          botId: "off-bot",
          name: "Archive",
          destination: "off",
          container: "stopped",
          ready: false,
          managed: true,
          problem: "This desktop image cannot safely resume; recreate the Local VM",
          inUse: true,
        },
      ],
      maxInstances: 4,
      loading: false,
      deletingBotId: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).toContain("2/4 created");
    expect(markup).toContain("Current destination: Cloud");
    expect(markup).toContain("Current destination: Off");
    expect(markup).toContain("In use");
    expect(markup).toContain("Stop this bot&#x27;s turn before deleting its desktop.");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).not.toMatch(/viewer_url|workspace_path|password=/);
  });

  it("keeps state labels honest", () => {
    expect(localVmInventoryState(cloudVm)).toBe("Running");
    expect(localVmInventoryState({ ...cloudVm, ready: false })).toBe("Needs attention");
    expect(localVmInventoryState({ ...cloudVm, container: "stopped", ready: false })).toBe("Stopped");
    expect(localVmInventoryState({ ...cloudVm, inUse: true })).toBe("In use");
  });

  it("does not claim there are no VMs when the runtime cannot be inspected", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [],
      maxInstances: 4,
      loading: false,
      deletingBotId: null,
      error: null,
      unavailableReason: "Start docker first",
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).toContain("Inventory unavailable");
    expect(markup).toContain("Start docker first");
    expect(markup).not.toContain("No per-bot desktops have been created");
  });

  it("disables deletion while refreshing an existing inventory", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [cloudVm],
      maxInstances: 4,
      loading: true,
      deletingBotId: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("shows unmanaged containers without offering an unsafe delete action", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [{
        ...cloudVm,
        managed: false,
        ready: false,
        problem: "Container labels do not match",
      }],
      maxInstances: 4,
      loading: false,
      deletingBotId: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).toContain("Not managed");
    expect(markup).toContain("not managed by OpenBot");
    expect(markup).toContain("remove it directly in Docker or Podman");
    expect(markup).not.toContain(">Delete</button>");
    expect(markup).not.toContain("Container labels do not match");
  });
});

describe("cloud computer inventory UI", () => {
  const renderCard = (overrides: Partial<Parameters<typeof CloudComputersCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(CloudComputersCard, {
      instances: [],
      configured: true,
      loading: false,
      pending: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onSleep: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }));

  it("shows owners, orphans, lifecycle state and only the sanitized machine name", () => {
    const markup = renderCard({
      instances: [
        ownedCloudComputer,
        {
          boxId: "another-provider-id",
          name: "ogb-orphaned-abcdef",
          state: "archived",
          ownerBotId: null,
          ownerName: null,
          orphaned: true,
          inUse: false,
        },
      ],
    });

    expect(markup).toContain("Research");
    expect(markup).toContain("Owned by this bot");
    expect(markup).toContain("Left-behind desktop");
    expect(markup).toContain("Its bot no longer exists");
    expect(markup).toContain("Running");
    expect(markup).toContain("Sleeping");
    expect(markup).toContain("ogb-current0-a1b2c3");
    expect(markup).not.toMatch(/provider-id-must-not-render|another-provider-id|desktopUrl|password|token=/);
  });

  it("disables destructive actions while the owner is working", () => {
    const markup = renderCard({ instances: [{ ...ownedCloudComputer, inUse: true }] });

    expect(markup).toContain("In use");
    expect(markup).toContain("Stop this bot&#x27;s work before changing its desktop.");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("disables lifecycle actions while refreshing an existing inventory", () => {
    const markup = renderCard({ instances: [ownedCloudComputer], loading: true });

    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("keeps disconnected, unavailable, and empty states distinct", () => {
    const disconnected = renderCard({ configured: false });
    expect(disconnected).toContain("Boat is not connected");
    expect(disconnected).not.toContain("No cloud desktops found");
    expect(disconnected.match(/Boat is not connected/g)).toHaveLength(1);
    expect(disconnected).toContain("Connect your Boat account");
    expect(disconnected).not.toContain("aria-busy");

    const unavailable = renderCard({ unavailableReason: "boat.dev is unavailable" });
    expect(unavailable).toContain("boat.dev is unavailable");
    expect(unavailable).not.toContain("No cloud desktops found");

    const endpointFailure = renderCard({ configured: null, unavailableReason: "Computer inventory could not load" });
    expect(endpointFailure).toContain("Computer inventory could not load");
    expect(endpointFailure).not.toContain("Boat is not connected");

    const empty = renderCard();
    expect(empty).toContain("No cloud desktops found");
  });

  it("uses honest state labels", () => {
    expect(cloudComputerInventoryState(ownedCloudComputer)).toBe("Running");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "archived" })).toBe("Sleeping");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "archiving" })).toBe("Going to sleep");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "removing" })).toBe("Removing");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "provisioning" })).toBe("Starting");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "unknown" })).toBe("Needs attention");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, inUse: true })).toBe("In use");
  });

  it("keeps a provider-accepted deletion visible while it is still pending", () => {
    const pending = reconcileCloudInventorySnapshot(
      [ownedCloudComputer],
      [ownedCloudComputer],
      { [ownedCloudComputer.boxId]: "deleting" },
    );

    expect(pending.instances).toEqual([{ ...ownedCloudComputer, state: "removing" }]);
    expect(pending.overrides).toEqual({ [ownedCloudComputer.boxId]: "deleting" });
    const markup = renderCard({ instances: pending.instances });
    expect(markup).toContain("Removing");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("clears a pending deletion only after inventory confirms absence", () => {
    const settled = reconcileCloudInventorySnapshot(
      [],
      [{ ...ownedCloudComputer, state: "removing" }],
      { [ownedCloudComputer.boxId]: "deleting" },
    );

    expect(settled.instances).toEqual([]);
    expect(settled.overrides).toEqual({});
  });

  it("does not treat an unavailable or unconfigured empty inventory as proof of deletion", () => {
    for (const payload of [
      { configured: true, available: false, problem: "Boat is unavailable", instances: [] },
      { configured: false, available: false, problem: null, instances: [] },
    ]) {
      const result = reconcileCloudInventoryPayload(
        payload,
        [{ ...ownedCloudComputer, state: "removing" }],
        { [ownedCloudComputer.boxId]: "deleting" },
      );

      expect(result.instances).toEqual([{ ...ownedCloudComputer, state: "removing" }]);
      expect(result.overrides).toEqual({ [ownedCloudComputer.boxId]: "deleting" });
    }
  });

  it("keeps cloud badge meaning and delete requests stable when the language changes", () => {
    const englishPlan = cloudComputerActionPlan("delete", ownedCloudComputer);
    for (const [locale, running, sleeping] of [
      ["pt-br", "Em execução", "Dormindo"],
      ["ja", "実行中", "スリープ中"],
    ]) {
      setLocale(locale);
      expect(renderCard({ instances: [ownedCloudComputer] }))
        .toContain(`bg-success/15 text-success">${running}</span>`);
      expect(renderCard({ instances: [{ ...ownedCloudComputer, state: "archived" }] }))
        .toContain(`bg-control text-ink-secondary">${sleeping}</span>`);
      const translatedPlan = cloudComputerActionPlan("delete", ownedCloudComputer);
      expect(translatedPlan.confirmation).not.toBe(englishPlan.confirmation);
      expect(translatedPlan.confirmation).toContain(ownedCloudComputer.ownerName);
      expect(translatedPlan.request).toEqual(englishPlan.request);
    }
  });

  it("does not let an eventually-consistent list resurrect a deleted computer", () => {
    const first = reconcileCloudInventorySnapshot(
      [ownedCloudComputer],
      [ownedCloudComputer],
      { [ownedCloudComputer.boxId]: "deleted" },
    );
    expect(first.instances).toEqual([]);
    expect(first.overrides).toEqual({ [ownedCloudComputer.boxId]: "deleted" });

    const later = reconcileCloudInventorySnapshot(
      [ownedCloudComputer],
      first.instances,
      first.overrides,
    );
    expect(later.instances).toEqual([]);

    const confirmedAbsent = reconcileCloudInventorySnapshot(
      [],
      later.instances,
      later.overrides,
    );
    expect(confirmedAbsent.instances).toEqual([]);
    expect(confirmedAbsent.overrides).toEqual({});
  });

  it("keeps a successful sleep visible until LIST reaches a sleeping state", () => {
    const stale = reconcileCloudInventorySnapshot(
      [{ ...ownedCloudComputer, state: "running" }],
      [ownedCloudComputer],
      { [ownedCloudComputer.boxId]: "sleeping" },
    );
    expect(stale.instances[0]?.state).toBe("archived");
    expect(stale.overrides).toEqual({ [ownedCloudComputer.boxId]: "sleeping" });

    const missing = reconcileCloudInventorySnapshot([], stale.instances, stale.overrides);
    expect(missing.instances[0]?.state).toBe("archived");
    expect(missing.overrides).toEqual(stale.overrides);

    const settled = reconcileCloudInventorySnapshot(
      [{ ...ownedCloudComputer, state: "archived" }],
      missing.instances,
      missing.overrides,
    );
    expect(settled.instances[0]?.state).toBe("archived");
    expect(settled.overrides).toEqual({});
  });

  it("announces cloud loading and action errors", () => {
    const loading = renderCard({ loading: true });
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');

    const failed = renderCard({ error: "Could not delete this computer" });
    expect(failed).toContain('role="alert"');
  });
});

describe("VPS computer inventory UI", () => {
  const ownedVps: VpsComputerInventoryInstance = {
    name: "openbot-vps-current-123456abcdef",
    state: "running",
    vpsAlias: "production-vps",
    ownerBotId: "current-owner",
    ownerName: "Research",
    orphaned: false,
    inUse: false,
  };
  const renderCard = (overrides: Partial<Parameters<typeof VpsComputersCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(VpsComputersCard, {
      instances: [],
      configured: true,
      aliases: ["production-vps"],
      loading: false,
      removingName: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onRemove: vi.fn(),
      ...overrides,
    }));

  it("shows the configured host, owners, orphans, and status without raw container details", () => {
    const orphanName = "openbot-vps-deleted-abcdef123456";
    const markup = renderCard({
      instances: [
        ownedVps,
        {
          name: orphanName,
          state: "exited",
          vpsAlias: "production-vps",
          ownerBotId: null,
          ownerName: null,
          orphaned: true,
          inUse: false,
        },
      ],
    });

    expect(markup).toContain("SSH host: production-vps");
    expect(markup).toContain("Research");
    expect(markup).toContain("Owned by this bot");
    expect(markup).toContain("Leftover desktop · ID ef123456");
    expect(markup).toContain("Its bot no longer exists");
    expect(markup).toContain("Running");
    expect(markup).toContain("Stopped");
    expect(markup).not.toMatch(new RegExp(`${ownedVps.name}|${orphanName}|containerId|VNC_PW|password`));
  });

  it("derives a stable identifier without exposing the bot-derived container name", () => {
    expect(vpsComputerShortId("openbot-vps-deleted-abcdef123456")).toBe("ef123456");
    expect(vpsComputerShortId("unexpected-provider-name")).toBe("unknown");
  });

  it("disables removal while the owner is working", () => {
    const markup = renderCard({ instances: [{ ...ownedVps, inUse: true }] });

    expect(markup).toContain("In use");
    expect(markup).toContain("Stop this bot&#x27;s work before removing its desktop.");
    expect(markup).toContain("disabled=\"\"");
  });

  it("disables removal while refreshing an existing inventory", () => {
    const markup = renderCard({ instances: [ownedVps], loading: true });

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("keeps disconnected, unavailable, and empty states distinct", () => {
    const disconnected = renderCard({ configured: false, aliases: [] });
    expect(disconnected).toContain("To use your own VPS, add its SSH alias");
    expect(disconnected.match(/No VPS is set up yet/g)).toHaveLength(1);
    expect(disconnected).not.toContain("aria-busy");
    expect(renderCard({ unavailableReason: "SSH host cannot be reached" })).toContain("SSH host cannot be reached");
    expect(renderCard()).toContain("No OpenBot desktops found on your VPS");
  });

  it("tags computers on more than one server and keeps reachable rows beside the warning", () => {
    const second = {
      ...ownedVps,
      name: "openbot-vps-second-123456abcdef",
      vpsAlias: "alpha-vps",
      ownerName: "Ops",
    };
    const multi = renderCard({ aliases: ["production-vps", "alpha-vps"], instances: [ownedVps, second] });
    expect(multi).toContain("SSH host: production-vps, alpha-vps");
    expect(multi).toContain("alpha-vps");
    expect(multi).not.toMatch(new RegExp(`${second.name}|containerId|VNC_PW`));

    // One unreachable server must not hide the computers it could still list.
    const partial = renderCard({
      aliases: ["production-vps", "alpha-vps"],
      instances: [ownedVps, second],
      unavailableReason: "Docker over SSH could not list managed computers on alpha-vps",
    });
    expect(partial).toContain("Docker over SSH could not list managed computers on alpha-vps");
    expect(partial).toContain("Research");
    expect(partial).toContain("Ops");
  });

  it("uses honest status labels", () => {
    expect(vpsComputerInventoryState(ownedVps)).toBe("Running");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "exited" })).toBe("Stopped");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "paused" })).toBe("Paused");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "restarting" })).toBe("Restarting");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "dead" })).toBe("Needs attention");
    expect(vpsComputerInventoryState({ ...ownedVps, inUse: true })).toBe("In use");
  });

  it("keeps running and paused VPS badge colors when labels are translated", () => {
    setLocale("pt-br");
    const running = renderCard({ instances: [ownedVps] });
    expect(running).toContain('bg-success/15 text-success">Em execução</span>');
    expect(running).toContain("Remover");
    expect(running).not.toContain(">Remove</button>");
    expect(renderCard({ instances: [{ ...ownedVps, state: "paused" }] }))
      .toContain('bg-control text-ink-secondary">Pausado</span>');
  });
});

describe("Settings → Computers on an OMB Cloud home", () => {
  afterEach(() => { storeFixture.config = null; });
  const cards = () => [...renderToStaticMarkup(createElement(LocalComputerSection)).matchAll(/<div class="text-\[16px\] font-semibold text-ink[^"]*">([^<]+)<\/div>/g)].map((match) => match[1]);

  it("sets up a Local VM on a desktop or self-hosted server", () => {
    expect(cards()).toEqual(expect.arrayContaining(["Cloud desktops", "Local cloud computer", "Setup"]));
  });

  it("shows no Local VM, and no steps to install one, where it cannot exist", () => {
    storeFixture.config = { cloudHome: true };
    const titles = cards();
    expect(titles).toContain("Cloud desktops");
    expect(titles).not.toContain("Local cloud computer");
    expect(titles).not.toContain("Setup");
  });
});

describe("Local cloud computer hero card & remote disclosure", () => {
  const baseStatus: LocalVmStatus = {
    platform: "darwin",
    runtime: "docker",
    available: ["docker"],
    daemonUp: true,
    image: false,
    imageMatches: true,
    managed: true,
    container: "missing",
    network: "loopback",
    security: "hardened",
    persistence: "durable",
    desktopReady: false,
    ready: false,
    problem: null,
    image_ref: "openbot-cua:latest",
    base_image_ref: "trycua/cua-ubuntu:latest",
    driver_version: "0.41.3",
    container_name: "openbot-vm",
    workspace_path: "/tmp/vm",
    workspace_guest_path: "/home/cua/workspace",
    viewer_url: "http://127.0.0.1:6901",
    idle_timeout_ms: 28_800_000,
    stop_reason: null,
    mode: "shared",
    max_instances: 2,
    commands: {
      install: "brew install --cask docker",
      runtimeStart: "open -a Docker || colima start",
      pull: "docker pull trycua/cua-ubuntu:latest",
      run: "docker run ...",
      start: "docker start openbot-vm",
      stop: "docker stop openbot-vm",
      remove: "docker rm -f openbot-vm",
      view: "http://127.0.0.1:6901",
    },
  };

  it("formats platform subtitles, runtime badges, and one-click actions by state", () => {
    const needsPrepare = renderToStaticMarkup(createElement(LocalCloudComputerCard, {
      status: baseStatus,
      loading: false,
      pending: null,
      prepareStage: null,
      error: null,
      onRecheck: vi.fn(),
      onAction: vi.fn(),
    }));
    expect(needsPrepare).toContain("Local cloud computer");
    expect(needsPrepare).toContain("macOS · Docker container sandbox");
    expect(needsPrepare).toContain(">Docker<");
    expect(needsPrepare).toContain("Prepare &amp; start local cloud computer");

    const wslStopped = renderToStaticMarkup(createElement(LocalCloudComputerCard, {
      status: {
        ...baseStatus,
        platform: "win32",
        runtime: "wsl-docker",
        daemonUp: false,
        problem: "Start wsl-docker first",
      },
      loading: false,
      pending: null,
      prepareStage: null,
      error: null,
      onRecheck: vi.fn(),
      onAction: vi.fn(),
    }));
    expect(wslStopped).toContain("Windows · WSL2 container sandbox");
    expect(wslStopped).toContain(">WSL2 Docker<");
    expect(wslStopped).toContain("Start WSL2 Docker first");

    const ready = renderToStaticMarkup(createElement(LocalCloudComputerCard, {
      status: { ...baseStatus, image: true, container: "running", desktopReady: true, ready: true },
      loading: false,
      pending: null,
      prepareStage: null,
      error: null,
      onRecheck: vi.fn(),
      onAction: vi.fn(),
    }));
    expect(ready).toContain("Watch screen");
    expect(ready).toContain("Stop / Sleep");
    expect(resolveHeroStateKind({ ...baseStatus, image: true, container: "stopped" }, false)).toBe("stopped");
  });

  it("collapses third-party Cloud/VPS disclosure when unconfigured and expands when configured", () => {
    expect(shouldExpandRemoteDesktops({ cloudConfigured: false, cloudCount: 0, vpsConfigured: false, vpsCount: 0 })).toBe(false);
    expect(shouldExpandRemoteDesktops({ cloudConfigured: null, cloudCount: 0, vpsConfigured: null, vpsCount: 0 })).toBe(false);
    expect(shouldExpandRemoteDesktops({ cloudConfigured: true, cloudCount: 0, vpsConfigured: false, vpsCount: 0 })).toBe(true);
    expect(shouldExpandRemoteDesktops({ cloudConfigured: false, cloudCount: 0, vpsConfigured: false, vpsCount: 1 })).toBe(true);

    const closed = renderToStaticMarkup(createElement(OtherRemoteDesktopsDisclosure, {
      cloudConfigured: false,
      cloudCount: 0,
      vpsConfigured: false,
      vpsCount: 0,
      children: createElement("div", null, "inner"),
    }));
    expect(closed).toContain("Other remote desktops (VPS / Cloud)");
    expect(closed).not.toContain("<details open");

    const opened = renderToStaticMarkup(createElement(OtherRemoteDesktopsDisclosure, {
      cloudConfigured: true,
      cloudCount: 0,
      vpsConfigured: false,
      vpsCount: 0,
      children: createElement("div", null, "inner"),
    }));
    expect(opened).toContain("<details open");
  });

  it("chains pull and run on Prepare & start in shared mode, and pull only in per-bot mode", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    let current: LocalVmStatus = { ...baseStatus, mode: "shared", image: false, ready: false };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/local-computer" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(current), { status: 200 });
      }
      if (url === "/api/local-computer/pull") {
        current = { ...current, image: true };
        return new Response(JSON.stringify(current), { status: 200 });
      }
      if (url === "/api/local-computer/run") {
        current = { ...current, container: "running", desktopReady: true, ready: true };
        return new Response(JSON.stringify(current), { status: 200 });
      }
      if (url === "/api/local-computer/instances") {
        return new Response(JSON.stringify({ instances: [], maxInstances: 2, available: true, problem: null }), { status: 200 });
      }
      if (url === "/api/computers/boxes") {
        return new Response(JSON.stringify({ configured: false, available: true, problem: null, instances: [] }), { status: 200 });
      }
      if (url === "/api/computers/vps") {
        return new Response(JSON.stringify({ configured: false, available: true, vpsAliases: [], problem: null, instances: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const host = document.createElement("div");
    document.body.append(host);
    const root: Root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(LocalComputerSection)); });
      await act(async () => { await Promise.resolve(); });

      const prepareBtn = [...host.querySelectorAll("button")].find((btn) =>
        btn.textContent?.includes("Prepare & start local cloud computer"),
      );
      expect(prepareBtn).toBeDefined();

      await act(async () => { prepareBtn!.click(); });
      await act(async () => { await Promise.resolve(); });

      expect(calls).toContain("POST /api/local-computer/pull");
      expect(calls).toContain("POST /api/local-computer/run");
      expect(calls.indexOf("POST /api/local-computer/pull")).toBeLessThan(calls.indexOf("POST /api/local-computer/run"));
      expect(host.textContent).toContain("Watch screen");

      calls.length = 0;
      current = { ...baseStatus, mode: "per-bot", image: false, ready: false };
      await act(async () => { root.unmount(); });
      const root2: Root = createRoot(host);
      try {
        await act(async () => { root2.render(createElement(LocalComputerSection)); });
        await act(async () => { await Promise.resolve(); });
        const perBotBtn = [...host.querySelectorAll("button")].find((btn) =>
          btn.textContent?.includes("Prepare & start local cloud computer"),
        );
        expect(perBotBtn).toBeDefined();
        await act(async () => { perBotBtn!.click(); });
        await act(async () => { await Promise.resolve(); });

        expect(calls).toContain("POST /api/local-computer/pull");
        expect(calls).not.toContain("POST /api/local-computer/run");
      } finally {
        await act(async () => { root2.unmount(); });
      }
    } finally {
      globalThis.fetch = originalFetch;
      host.remove();
    }
  });
});

describe("Local VM idle timeout setting", () => {
  it.each([["5", 5], ["30", 30], [" 480 ", 480], ["1440", 1_440]])("accepts %j", (value, minutes) => {
    expect(parseLocalVmIdleTimeoutMinutes(value)).toBe(minutes);
  });

  it.each(["", "4", "1441", "1.5", "-30", "30m", "1e2"])("rejects %j", (value) => {
    expect(parseLocalVmIdleTimeoutMinutes(value)).toBeNull();
  });

  it("shows the confirmed window as a bounded, labelled minutes field", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmIdleTimeoutSetting, {
      minutes: 30,
      disabled: false,
      onSave: async () => {},
    }));
    expect(markup).toContain('for="local-vm-idle-timeout"');
    expect(markup).toContain("Stop idle desktops after");
    expect(markup).toContain('min="5"');
    expect(markup).toContain('max="1440"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain("minutes");
  });
});
