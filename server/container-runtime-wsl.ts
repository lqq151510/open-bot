export const RUNTIMES = ["docker", "wsl-docker", "podman", "container"] as const;
export type Runtime = (typeof RUNTIMES)[number];

export type CommandRunner = (
  command: string,
  args: string[],
  timeout?: number,
) => Promise<{ stdout: string }>;

export function runtimeCandidates(platform: NodeJS.Platform): Runtime[] {
  if (platform === "win32") return ["docker", "wsl-docker", "podman"];
  if (platform === "darwin") return ["docker", "podman", "container"];
  return ["docker", "podman"];
}

export function spawnRuntimeCommand(
  runtime: Runtime,
  args: string[],
): { command: string; args: string[] } {
  return runtime === "wsl-docker"
    ? { command: "wsl.exe", args: ["--", "docker", ...args] }
    : { command: runtime, args };
}

export async function runRuntimeCommand(
  runtime: Runtime,
  args: string[],
  runner: CommandRunner,
  timeout?: number,
): Promise<{ stdout: string }> {
  const resolved = spawnRuntimeCommand(runtime, args);
  return runner(resolved.command, resolved.args, timeout);
}

async function binaryExists(cmd: string, runner: CommandRunner, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await runner(platform === "win32" ? "where.exe" : "/usr/bin/which", [cmd], 4000);
    return true;
  } catch {
    return false;
  }
}

export async function isRuntimeInstalled(
  runtime: Runtime,
  runner: CommandRunner,
  platform: NodeJS.Platform,
): Promise<boolean> {
  if (runtime !== "wsl-docker") return binaryExists(runtime, runner, platform);
  if (!(await binaryExists("wsl.exe", runner, platform))) return false;
  try {
    await runner("wsl.exe", ["--", "sh", "-lc", "command -v docker"], 5000);
    return true;
  } catch {
    return false;
  }
}

export function windowsPathToWslMount(winPath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!match) return winPath;
  const drive = match[1].toLowerCase();
  const rest = match[2].replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
}

function parseWslMountSegments(source: string): { drive: string; rest: string[] } | null {
  if (!source.startsWith("/") || /[\0\\]/.test(source)) return null;
  const trimmed = source.length > 1 && source.endsWith("/") ? source.slice(0, -1) : source;
  const segments = trimmed.slice(1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  if (segments[0] === "mnt" || segments[0] === "host_mnt") {
    if (segments.length < 2 || !/^[A-Za-z]$/.test(segments[1]!)) return null;
    return { drive: segments[1]!.toLowerCase(), rest: segments.slice(2) };
  }
  if (segments[0] === "run" && segments[1] === "desktop" && segments[2] === "mnt" && segments[3] === "host") {
    if (segments.length < 5 || !/^[A-Za-z]$/.test(segments[4]!)) return null;
    return { drive: segments[4]!.toLowerCase(), rest: segments.slice(5) };
  }
  return null;
}

function parseWindowsWorkspaceSegments(expectedWorkspace: string): { drive: string; rest: string[] } | null {
  if (!expectedWorkspace || /[\0]/.test(expectedWorkspace)) return null;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(expectedWorkspace);
  if (!match) return null;
  const trimmed = match[2].replaceAll("\\", "/").replace(/\/+$/, "");
  const rest = trimmed === "" ? [] : trimmed.split("/");
  if (rest.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return { drive: match[1].toLowerCase(), rest };
}

/** Windows Docker Desktop and WSL2 expose host bind mounts under three Linux mount roots; reject traversal or prefix matches. */
export function matchesWindowsWslMountSource(source: string | undefined, expectedWorkspace: string): boolean {
  if (!source) return false;
  const actual = parseWslMountSegments(source);
  const expected = parseWindowsWorkspaceSegments(expectedWorkspace);
  if (!actual || !expected) return false;
  if (actual.drive !== expected.drive || actual.rest.length !== expected.rest.length) return false;
  return actual.rest.every((segment, index) => segment.toLowerCase() === expected.rest[index]!.toLowerCase());
}

export interface SetupCommandOptions {
  runtime: Runtime | null;
  platform: NodeJS.Platform;
  containerName: string;
  viewerPort: number | null;
  pullArgs: string[] | null;
  runArgs: string[] | null;
}

function installCommand(platform: NodeJS.Platform): string | null {
  if (platform === "darwin") return "brew install --cask docker";
  if (platform === "win32") return "wsl --install && winget install -e --id Docker.DockerDesktop";
  return null;
}

function runtimeStartCommand(runtime: Runtime | null, platform: NodeJS.Platform): string | null {
  if (!runtime) return null;
  if (runtime === "docker" && platform === "darwin") return "open -a Docker || colima start";
  if (runtime === "docker" && platform === "win32") {
    return "powershell -NoProfile -Command \"Start-Process 'C:\\Program Files\\Docker\\Docker Desktop.exe'\"";
  }
  if (runtime === "wsl-docker") return "wsl.exe -u root -- sh -lc \"service docker start || systemctl start docker\"";
  if (runtime === "docker" && platform === "linux") return "sudo systemctl start docker";
  if (runtime === "podman" && platform !== "linux") return "podman machine start";
  if (runtime === "container") return "container system start";
  return null;
}

export function buildSetupCommands(options: SetupCommandOptions) {
  const { runtime, platform, containerName, viewerPort, pullArgs, runArgs } = options;
  const install = installCommand(platform);
  const runtimeStart = runtimeStartCommand(runtime, platform);
  const view = viewerPort ? `http://127.0.0.1:${viewerPort}/vnc.html` : "";
  if (!runtime) {
    return {
      install,
      runtimeStart: null,
      pull: null,
      run: null,
      start: null,
      stop: null,
      remove: null,
      view,
    };
  }
  const prefix = runtime === "wsl-docker" ? "wsl -- docker" : runtime;
  const format = (args: string[]) => [prefix, ...args].join(" ");
  return {
    install,
    runtimeStart,
    pull: pullArgs ? format(pullArgs) : null,
    run: runArgs ? format(runArgs) : null,
    start: format(["start", containerName]),
    stop: format(["stop", containerName]),
    remove: format(["rm", runtime === "container" ? "--force" : "-f", containerName]),
    view,
  };
}
