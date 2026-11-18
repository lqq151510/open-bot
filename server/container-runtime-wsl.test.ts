import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BASE_IMAGE,
  BASE_IMAGE_DIGEST,
  BASE_IMAGE_LABEL,
  CONTAINER,
  CUA_DRIVER_VERSION,
  CUA_EXECUTABLE,
  CUA_SOCKET,
  DRIVER_LABEL,
  IMAGE,
  IMAGE_LAYER_LABEL,
  IMAGE_LAYER_VERSION,
  MANAGED_LABEL,
  TARGET_LABEL,
  VM_WORKSPACE_GUEST,
  WORKSPACE_LABEL,
  containerComputerAction,
  containerComputerExists,
  containerComputerFrame,
  containerComputerStatus,
  containerExec,
  containerRunArgs,
  containerRuntimeStatus,
  perBotLocalVmTarget,
  setupCommands,
  type CommandRunner,
  type LocalVmTarget,
} from "./container-computer.ts";
import { PIDS_LIMIT } from "./container-limits.ts";
import {
  RUNTIMES,
  matchesWindowsWslMountSource,
  runtimeCandidates,
  spawnRuntimeCommand,
  windowsPathToWslMount,
} from "./container-runtime-wsl.ts";
import { createBotLifecycleRoutes } from "./routes/bot-lifecycle.ts";
import type { RouteContext } from "./routes/table.ts";
import type { BotRecord, TaskRecord } from "./store.ts";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function runner(responses: Record<string, string | Error>) {
  const calls: string[] = [];
  const run: CommandRunner = async (command, args) => {
    const key = [command, ...args].join(" ");
    calls.push(key);
    const response = responses[key];
    if (response instanceof Error || response === undefined) {
      throw response ?? new Error(`unexpected command: ${key}`);
    }
    return { stdout: response };
  };
  return { calls, run };
}

function preparedImageInspect() {
  return JSON.stringify([
    {
      Id: "sha256:managed-image-id",
      Config: {
        Labels: {
          [MANAGED_LABEL]: "1",
          [DRIVER_LABEL]: CUA_DRIVER_VERSION,
          [BASE_IMAGE_LABEL]: BASE_IMAGE_DIGEST,
          [IMAGE_LAYER_LABEL]: IMAGE_LAYER_VERSION,
        },
      },
    },
  ]);
}

function windowsReadyInspect(source: string, targetLabel: string, pidsLimit = PIDS_LIMIT) {
  return JSON.stringify([
    {
      Config: {
        Image: IMAGE,
        Labels: {
          [MANAGED_LABEL]: "1",
          [DRIVER_LABEL]: CUA_DRIVER_VERSION,
          [BASE_IMAGE_LABEL]: BASE_IMAGE_DIGEST,
          [IMAGE_LAYER_LABEL]: IMAGE_LAYER_VERSION,
          [WORKSPACE_LABEL]: "1",
          [TARGET_LABEL]: targetLabel,
        },
        Env: ["VNC_PW=secret123"],
      },
      State: { Running: true },
      Image: "sha256:managed-image-id",
      HostConfig: {
        Memory: 4 * 1024 * 1024 * 1024,
        MemorySwap: 4 * 1024 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        PidsLimit: pidsLimit,
        CapDrop: ["ALL"],
        CapAdd: ["CAP_SETUID", "CAP_SETGID"],
        Privileged: false,
        IpcMode: "private",
        CgroupnsMode: "private",
        ShmSize: 512 * 1024 * 1024,
        RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
        PortBindings: { "6901/tcp": [{ HostIp: "127.0.0.1", HostPort: "49155" }] },
      },
      NetworkSettings: {
        Ports: { "6901/tcp": [{ HostIp: "127.0.0.1", HostPort: "49155" }] },
      },
      Mounts: [{ Type: "bind", Source: source, Destination: VM_WORKSPACE_GUEST, RW: true }],
    },
  ]);
}

const validPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(600),
  Buffer.from("IEND", "ascii"),
]);

describe("Windows runtime candidates and detection", () => {
  it("lists candidates in priority order per platform", () => {
    expect(RUNTIMES).toEqual(["docker", "wsl-docker", "podman", "container"]);
    expect(runtimeCandidates("win32")).toEqual(["docker", "wsl-docker", "podman"]);
    expect(runtimeCandidates("darwin")).toEqual(["docker", "podman", "container"]);
    expect(runtimeCandidates("linux")).toEqual(["docker", "podman"]);
  });

  it("falls back from Docker Desktop to WSL2 Docker, and then to Podman on Windows", async () => {
    const wslFallback = runner({
      "where.exe docker": "C:\\Program Files\\Docker\\docker.exe\n",
      "where.exe wsl.exe": "C:\\Windows\\System32\\wsl.exe\n",
      "wsl.exe -- sh -lc command -v docker": "/usr/bin/docker\n",
      "where.exe podman": "C:\\Program Files\\RedHat\\Podman\\podman.exe\n",
      "docker info --format {{.ServerVersion}}": new Error("Docker Desktop stopped"),
      "wsl.exe -- docker info --format {{.ServerVersion}}": "27.5.0\n",
      "podman info --format json": '{"host":{"arch":"amd64"}}\n',
    });
    expect(await containerRuntimeStatus(wslFallback.run, "win32")).toEqual({
      runtime: "wsl-docker",
      available: ["docker", "wsl-docker", "podman"],
      daemonUp: true,
    });

    const wslOnly = runner({
      "where.exe docker": new Error("missing"),
      "where.exe wsl.exe": "C:\\Windows\\System32\\wsl.exe\n",
      "wsl.exe -- sh -lc command -v docker": "/usr/bin/docker\n",
      "where.exe podman": new Error("missing"),
      "wsl.exe -- docker info --format {{.ServerVersion}}": new Error("daemon stopped"),
    });
    expect(await containerRuntimeStatus(wslOnly.run, "win32")).toEqual({
      runtime: "wsl-docker",
      available: ["wsl-docker"],
      daemonUp: false,
    });

    const wslWithoutDocker = runner({
      "where.exe docker": new Error("missing"),
      "where.exe wsl.exe": "C:\\Windows\\System32\\wsl.exe\n",
      "wsl.exe -- sh -lc command -v docker": new Error("not found"),
      "where.exe podman": "C:\\Program Files\\RedHat\\Podman\\podman.exe\n",
      "podman info --format json": '{"host":{"arch":"amd64"}}\n',
    });
    expect(await containerRuntimeStatus(wslWithoutDocker.run, "win32")).toEqual({
      runtime: "podman",
      available: ["podman"],
      daemonUp: true,
    });
  });
});

describe("WSL path translation and mount validation", () => {
  it("converts Windows paths to WSL mounts and leaves non-Windows paths untouched", () => {
    expect(windowsPathToWslMount("C:\\foo\\bar")).toBe("/mnt/c/foo/bar");
    expect(windowsPathToWslMount("C:/foo/bar")).toBe("/mnt/c/foo/bar");
    expect(windowsPathToWslMount("D:\\")).toBe("/mnt/d");
    expect(windowsPathToWslMount("D:/")).toBe("/mnt/d");
    expect(windowsPathToWslMount("/Users/alice/workspace")).toBe("/Users/alice/workspace");
    expect(windowsPathToWslMount("\\\\server\\share\\dir")).toBe("\\\\server\\share\\dir");
  });

  it("accepts all three WSL2 bind mount forms case-insensitively and rejects traversal or prefix mismatches", () => {
    const expected = "C:\\Users\\Light\\.openbot\\vm-homes\\win-target";
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes/win-target", expected)).toBe(true);
    expect(matchesWindowsWslMountSource("/mnt/C/users/light/.openbot/VM-HOMES/WIN-TARGET", expected)).toBe(true);
    expect(matchesWindowsWslMountSource("/run/desktop/mnt/host/c/Users/Light/.openbot/vm-homes/win-target", expected)).toBe(true);
    expect(matchesWindowsWslMountSource("/host_mnt/c/Users/Light/.openbot/vm-homes/win-target", expected)).toBe(true);
    expect(matchesWindowsWslMountSource("/mnt/c", "C:\\")).toBe(true);

    expect(matchesWindowsWslMountSource(undefined, expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes/win-target-evil", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes/win-target/sub", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes/win-target/../win-target", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/./.openbot/vm-homes/win-target", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes/win-target//", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes\\..\\win-target", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/d/Users/Light/.openbot/vm-homes/win-target", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/other/c/Users/Light/.openbot/vm-homes/win-target", expected)).toBe(false);
    expect(matchesWindowsWslMountSource("/mnt/c/Users/Light/.openbot/vm-homes/win-target", "/home/cua/workspace")).toBe(false);
  });

  it.each(["docker", "wsl-docker"] as const)(
    "accepts WSL2 mount roots and rejects unsafe traversal on %s in containerComputerStatus",
    async (runtime) => {
      const target: LocalVmTarget = {
        ...perBotLocalVmTarget("win-wsl"),
        workspaceDir: "C:\\Users\\light\\.openbot\\vm-homes\\win-wsl",
      };
      const baseSetup: Record<string, string | Error> = runtime === "wsl-docker"
        ? {
            "where.exe docker": new Error("missing"),
            "where.exe wsl.exe": "C:\\Windows\\System32\\wsl.exe\n",
            "wsl.exe -- sh -lc command -v docker": "/usr/bin/docker\n",
            "where.exe podman": new Error("missing"),
            "wsl.exe -- docker info --format {{.ServerVersion}}": "27.5.0\n",
            [`wsl.exe -- docker image inspect ${IMAGE}`]: preparedImageInspect(),
          }
        : {
            "where.exe docker": "C:\\Program Files\\Docker\\docker.exe\n",
            "where.exe wsl.exe": new Error("missing"),
            "where.exe podman": new Error("missing"),
            "docker info --format {{.ServerVersion}}": "29.0.0\n",
            [`docker image inspect ${IMAGE}`]: preparedImageInspect(),
          };
      const inspectKey = runtime === "wsl-docker"
        ? `wsl.exe -- docker inspect ${target.containerName}`
        : `docker inspect ${target.containerName}`;

      for (const validSource of [
        "/mnt/c/Users/light/.openbot/vm-homes/win-wsl",
        "/run/desktop/mnt/host/c/Users/light/.openbot/vm-homes/win-wsl",
        "/host_mnt/c/Users/light/.openbot/vm-homes/win-wsl",
      ]) {
        const fake = runner({
          ...baseSetup,
          [inspectKey]: windowsReadyInspect(validSource, target.label),
        });
        const status = await containerComputerStatus(fake.run, "win32", target, { probeDesktop: false });
        expect(status.runtime).toBe(runtime);
        expect(status.persistence).toBe("durable");
      }

      const unsafe = runner({
        ...baseSetup,
        [inspectKey]: windowsReadyInspect("/run/desktop/mnt/host/c/Users/light/.openbot/vm-homes/win-wsl/../other", target.label),
      });
      const bad = await containerComputerStatus(unsafe.run, "win32", target, { probeDesktop: false });
      expect(bad.persistence).toBe("unsafe");
      expect(bad.problem).toContain("durable folder");
    },
  );
});

describe("wsl-docker command wrapping and lifecycle", () => {
  it("wraps wsl-docker commands through wsl.exe -- docker and translates Windows run/setup mounts", async () => {
    expect(spawnRuntimeCommand("wsl-docker", ["ps"])).toEqual({
      command: "wsl.exe",
      args: ["--", "docker", "ps"],
    });
    expect(spawnRuntimeCommand("docker", ["ps"])).toEqual({
      command: "docker",
      args: ["ps"],
    });

    const winTarget: LocalVmTarget = {
      ...perBotLocalVmTarget("win-run"),
      workspaceDir: "C:\\Users\\light\\.openbot\\vm-homes\\win-run",
    };
    const wslArgs = containerRunArgs("wsl-docker", "secret", winTarget, "win32");
    expect(wslArgs[wslArgs.indexOf("--mount") + 1]).toBe(
      `type=bind,source=/mnt/c/Users/light/.openbot/vm-homes/win-run,target=${VM_WORKSPACE_GUEST}`,
    );
    const desktopArgs = containerRunArgs("docker", "secret", winTarget, "win32");
    expect(desktopArgs[desktopArgs.indexOf("--mount") + 1]).toBe(
      `type=bind,source=C:\\Users\\light\\.openbot\\vm-homes\\win-run,target=${VM_WORKSPACE_GUEST}`,
    );

    const commands = setupCommands("wsl-docker", "win32", winTarget);
    expect(commands.pull).toBe(`wsl -- docker pull ${BASE_IMAGE}`);
    expect(commands.start).toBe(`wsl -- docker start ${winTarget.containerName}`);
    expect(commands.stop).toBe(`wsl -- docker stop ${winTarget.containerName}`);
    expect(commands.remove).toBe(`wsl -- docker rm -f ${winTarget.containerName}`);
    expect(commands.run).toContain("wsl -- docker run -d");
    expect(commands.run).toContain("source=/mnt/c/Users/light/.openbot/vm-homes/win-run");
  });

  it("routes pull, inspect, frame capture, pids update, and exec through wsl.exe -- docker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omb-wsl-docker-"));
    temporary.push(dir);
    const target: LocalVmTarget = {
      ...perBotLocalVmTarget("win-flow"),
      workspaceDir: join(dir, "workspace"),
    };
    await mkdir(target.workspaceDir, { recursive: true });

    let built = false;
    const calls: string[] = [];
    const run: CommandRunner = async (command, args) => {
      const full = [command, ...args].join(" ");
      calls.push(full);
      if (command === "where.exe" && args[0] === "wsl.exe") return { stdout: "C:\\Windows\\System32\\wsl.exe\n" };
      if (command === "where.exe") throw new Error("missing");
      if (full === "wsl.exe -- sh -lc command -v docker") return { stdout: "/usr/bin/docker\n" };
      if (full === "wsl.exe -- docker info --format {{.ServerVersion}}") return { stdout: "27.5.0\n" };
      if (full === `wsl.exe -- docker image inspect ${IMAGE}`) {
        if (!built) throw new Error("missing image");
        return { stdout: preparedImageInspect() };
      }
      if (full === `wsl.exe -- docker inspect ${target.containerName}`) {
        return { stdout: windowsReadyInspect(target.workspaceDir, target.label, 512) };
      }
      if (full === `wsl.exe -- docker pull ${BASE_IMAGE}`) return { stdout: "pulled" };
      if (full.startsWith("wsl.exe -- docker build ")) {
        built = true;
        return { stdout: "built" };
      }
      if (full === `wsl.exe -- docker update --pids-limit ${PIDS_LIMIT} ${target.containerName}`) return { stdout: "" };
      if (full.includes(" --version")) return { stdout: `cua-driver ${CUA_DRIVER_VERSION}\n` };
      if (full.includes(" status --socket ")) return { stdout: "running\n" };
      if (full.includes(" health_report ")) return { stdout: JSON.stringify({ schema_version: "1", overall: "ok", checks: [] }) };
      if (full.includes(" get_desktop_state ")) return { stdout: "{}\n" };
      if (full.includes(" base64 -w0 ")) return { stdout: validPng.toString("base64") };
      throw new Error(`unexpected: ${full}`);
    };

    const pulled = await containerComputerAction("pull", run, "win32", target);
    expect(pulled.ready).toBe(true);
    expect(calls).toContain(`wsl.exe -- docker pull ${BASE_IMAGE}`);
    expect(calls.some((call) => call.startsWith(`wsl.exe -- docker build --force-rm -t ${IMAGE} `))).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toContain(`wsl.exe -- docker update --pids-limit ${PIDS_LIMIT} ${target.containerName}`);

    expect(await containerComputerExists("wsl-docker", target, run)).toBe(true);
    const frame = await containerComputerFrame(run, "win32", target);
    expect(frame.format).toBe("png");

    const execCalls: Array<{ command: string; args: string[] }> = [];
    const execResult = await containerExec(target, "echo ok", {
      runtime: "wsl-docker",
      exec: async (command, args) => {
        execCalls.push({ command, args });
        return { stdout: "ok\n", stderr: "", code: 0 };
      },
    });
    expect(execResult).toEqual({ exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false });
    expect(execCalls).toEqual([
      {
        command: "wsl.exe",
        args: [
          "--", "docker", "exec", "-u", "cua", "-w", VM_WORKSPACE_GUEST,
          "-e", "HOME=/home/cua", "-e", "DISPLAY=:1",
          target.containerName, "timeout", "-k", "5", "60", "sh", "-lc", "echo ok",
        ],
      },
    ]);
  });

  const posixOnly = describe.skipIf(process.platform === "win32");
  posixOnly("wraps container-mcp through wsl.exe -- docker when runtime is wsl-docker", () => {
    it("accepts wsl-docker and passes -- docker exec ... to wsl.exe", async () => {
      const bin = await mkdtemp(join(tmpdir(), "openbot-wsl-mcp-"));
      temporary.push(bin);
      const fakeWsl = join(bin, "wsl.exe");
      await writeFile(fakeWsl, "#!/bin/sh\nprintf 'ARGS:%s\\n' \"$*\" >&2\ncat\n", { mode: 0o700 });
      await chmod(fakeWsl, 0o700);

      const input = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n';
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("./container-mcp.ts", import.meta.url)), "wsl-docker", CONTAINER, CUA_SOCKET],
          {
            env: { ...process.env, OMB_EXTRA_PATH: bin, NODE_NO_WARNINGS: "1" },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(input);
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe(input);
      expect(result.stderr).toContain(
        `ARGS:-- docker exec -i -u cua -e HOME=/home/cua -e DISPLAY=:1 -e CUA_DRIVER_INSTALL_CHANNEL=python_package ` +
          `-e CUA_DRIVER_RS_TELEMETRY_ENABLED=0 ${CONTAINER} ${CUA_EXECUTABLE} mcp --socket ${CUA_SOCKET}`,
      );
    });

    it("still rejects unknown runtimes with exit code 2", async () => {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("./container-mcp.ts", import.meta.url)), "nerdctl", CONTAINER, CUA_SOCKET],
          { env: { ...process.env, NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stderr }));
      });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("invalid Local VM runtime");
    });
  });
});

describe("POST /api/local-computer/interrupt for Auto bots", () => {
  it("interrupts bots working on local surface under Auto mode as well as explicit computer=local bots", async () => {
    const bots: BotRecord[] = [
      {
        id: "bot-auto-local",
        tasks: [{ threadId: "t-local", surface: "local" } as TaskRecord],
      } as unknown as BotRecord,
      {
        id: "bot-auto-vm",
        tasks: [{ threadId: "t-vm", surface: "vm" } as TaskRecord],
      } as unknown as BotRecord,
      {
        id: "bot-explicit-local",
        computer: "local",
        tasks: [],
      } as unknown as BotRecord,
    ];

    const interruptAllDirectThreads = vi.fn(async () => {});
    const cancelDirectTurnDispatch = vi.fn();
    const revokeInternalCapabilitiesForThread = vi.fn();
    const cancelRun = vi.fn(async () => {});
    const cancelGroupTurnOperations = vi.fn();
    const interruptTurn = vi.fn(async () => {});
    const closeOpenApprovals = vi.fn();

    const handler = createBotLifecycleRoutes({
      store: { bots },
      routines: () => ({
        activeBotRunForBot: (botId: string) =>
          botId === "bot-auto-local" ? ({ id: "run-1", threadId: "t-routine" } as never) : null,
        cancelRun,
      } as never),
      interruptAllDirectThreads,
      cancelDirectTurnDispatch,
      revokeInternalCapabilitiesForThread,
      activeGroupTurnForBot: (botId: string) =>
        botId === "bot-auto-local" ? ({ group: { id: "grp-1" } as never, threadId: "t-group" }) : null,
      cancelGroupTurnOperations,
      runningTurnInstance: () => ({ adapter: { interruptTurn } } as never),
      closeOpenApprovals,
      deleteBotWithLifecycle: vi.fn(),
    });

    const sent: Array<{ status: number; body: unknown }> = [];
    await handler({
      req: { headers: { "content-type": "application/json" } } as unknown as IncomingMessage,
      res: {} as ServerResponse,
      url: new URL("http://localhost/api/local-computer/interrupt"),
      path: "/api/local-computer/interrupt",
      method: "POST",
      auth: { kind: "loopback", scopes: ["admin"] },
      json: ((_res: ServerResponse, status: number, body: unknown) => {
        sent.push({ status, body });
      }) as RouteContext["json"],
      readBody: (async () => ({})) as RouteContext["readBody"],
    });

    expect(sent).toEqual([{ status: 200, body: { ok: true } }]);
    expect(interruptAllDirectThreads).toHaveBeenCalledWith("bot-auto-local");
    expect(interruptAllDirectThreads).toHaveBeenCalledWith("bot-explicit-local");
    expect(interruptAllDirectThreads).not.toHaveBeenCalledWith("bot-auto-vm");
    expect(cancelDirectTurnDispatch).toHaveBeenCalledWith("bot-auto-local", "t-routine");
    expect(revokeInternalCapabilitiesForThread).toHaveBeenCalledWith("t-routine");
    expect(cancelRun).toHaveBeenCalledWith("run-1");
    expect(cancelGroupTurnOperations).toHaveBeenCalledWith("grp-1", "t-group");
    expect(revokeInternalCapabilitiesForThread).toHaveBeenCalledWith("t-group");
    expect(interruptTurn).toHaveBeenCalledWith("t-group");
    expect(closeOpenApprovals).toHaveBeenCalledWith("t-group");
  });
});
