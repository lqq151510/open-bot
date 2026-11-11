import { beforeEach, expect, it, vi } from "vitest";
import { listManagedBoats } from "./boat.ts";
import { containerComputerStatus, containerRuntimeStatus, type ContainerComputerStatus } from "./container-computer.ts";
import { readComputerImageUpdates } from "./computer-image-updates.ts";
import { listManagedVpsComputers } from "./vps-computer.ts";

vi.mock("./boat.ts", () => ({ listManagedBoats: vi.fn() }));
vi.mock("./container-computer.ts", async (original) => ({
  ...await original<typeof import("./container-computer.ts")>(),
  containerComputerStatus: vi.fn(),
  containerRuntimeStatus: vi.fn(),
}));
vi.mock("./vps-computer.ts", () => ({ listManagedVpsComputers: vi.fn() }));

const options = { cfg: {}, bots: [], owners: [], localBusy: () => false };
const local = vi.mocked(containerComputerStatus);
const managed = { managed: true, container: "stopped", image: true, imageMatches: true, image_identity_matches: true } as const;

beforeEach(() => {
  vi.mocked(containerRuntimeStatus).mockResolvedValue({ runtime: "docker", available: ["docker"], daemonUp: true });
  local.mockResolvedValue(managed as ContainerComputerStatus);
  vi.mocked(listManagedVpsComputers).mockResolvedValue({
    configured: false, available: false, vpsAliases: [], problem: null, instances: [],
  });
  vi.mocked(listManagedBoats).mockResolvedValue({ configured: false, available: false, problem: null, instances: [] });
});

it("reports a confirmed old image as ready or busy depending on the current lease", async () => {
  local.mockResolvedValue({ ...managed, imageMatches: false, image_identity_matches: false } as ContainerComputerStatus);
  expect(await readComputerImageUpdates(options)).toMatchObject({
    status: "ready", computers: [{ id: "shared", status: "ready" }], unverified: false,
  });
  expect(await readComputerImageUpdates({ ...options, localBusy: () => true })).toMatchObject({
    status: "busy", computers: [{ id: "shared", status: "busy" }], unverified: false,
  });
});

it("avoids a global current result when a configured provider could not be checked", async () => {
  vi.mocked(listManagedBoats).mockResolvedValue({ configured: true, available: false, problem: "unreachable", instances: [] });
  expect(await readComputerImageUpdates(options)).toMatchObject({
    status: "waiting", computers: [{ id: "shared", status: "current" }], unverified: true,
  });
});

it("waits when image labels exist but the running image identity cannot be verified", async () => {
  local.mockResolvedValue({ ...managed, imageMatches: false, image_identity_matches: undefined } as ContainerComputerStatus);
  expect(await readComputerImageUpdates(options)).toMatchObject({
    status: "waiting", computers: [{ id: "shared", status: "waiting" }], unverified: true,
  });
});

it("reports unavailable without a verified managed computer", async () => {
  local.mockResolvedValue({ ...managed, managed: false, container: "missing" } as ContainerComputerStatus);
  expect(await readComputerImageUpdates(options)).toEqual({ status: "unavailable", computers: [], unverified: false });
});
