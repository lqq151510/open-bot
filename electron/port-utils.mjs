import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The server listens on the wildcard address, so probing only 127.0.0.1 misses
// a listener on another interface. A bind that fails with anything other than
// EADDRINUSE (EACCES, EADDRNOTAVAIL) means the port cannot be used either, but
// it does not mean another program owns it.
const PROBE_HOSTS = ["0.0.0.0", "127.0.0.1"];

function assertPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`port must be an integer from 1 to 65535, received ${String(port)}`);
  }
}

function bindOnce(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve({ free: false, code: error.code ?? error.message }));
    server.once("listening", () => server.close(() => resolve({ free: true })));
    server.listen({ host, port, exclusive: true });
  });
}

/** Reports whether every address the server binds accepts a listener on {@link port}. */
export async function probePort(port) {
  assertPort(port);
  let taken = false;
  let blocked;
  for (const host of PROBE_HOSTS) {
    const result = await bindOnce(host, port);
    if (result.free) continue;
    if (result.code === "EADDRINUSE") taken = true;
    else blocked ??= result.code;
  }
  if (taken) return { free: false, code: "EADDRINUSE" };
  if (blocked) return { free: false, code: blocked };
  return { free: true };
}

function listeningPids(port) {
  return process.platform === "win32" ? windowsListeningPids(port) : unixListeningPids(port);
}

async function unixListeningPids(port) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    return stdout.split("\n").map((line) => Number(line.trim()));
  } catch {
    return [];
  }
}

async function windowsListeningPids(port) {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"]);
    return stdout
      .split("\n")
      .filter((line) => line.includes("LISTENING") && line.includes(`:${port} `))
      .map((line) => Number(line.trim().split(/\s+/).at(-1)));
  } catch {
    return [];
  }
}

/** Stops the processes listening on {@link port}, without going through a shell. */
export async function killPort(port) {
  assertPort(port);
  const candidates = [...new Set(await listeningPids(port))].filter((pid) => Number.isInteger(pid) && pid > 1);
  const pids = [];
  for (const pid of candidates) {
    try {
      if (process.platform === "win32") await execFileAsync("taskkill", ["/PID", String(pid), "/F"]);
      else process.kill(pid, "SIGKILL");
      pids.push(pid);
    } catch {
      // The process exited between lsof and kill, or it belongs to another user.
    }
  }
  return { killed: pids.length > 0, pids };
}

/**
 * Keeps the app from starting on a port another program holds. Offers to stop
 * that program and relaunch when it owns the port; anything else is a plain
 * refusal, since stopping an unrelated listener would be a guess.
 * Returns false once the caller should stop starting up.
 */
export async function ensureServerPort({ port, app, dialog, t }) {
  const probe = await probePort(port);
  if (probe.free) return true;
  const taken = probe.code === "EADDRINUSE";
  const { response } = await dialog.showMessageBox({
    type: "error",
    buttons: taken ? [t("native.dialog.portOccupied.restart"), t("native.role.quit")] : [t("native.role.quit")],
    defaultId: taken ? 1 : 0,
    cancelId: 0,
    title: t(taken ? "native.dialog.portOccupied.title" : "native.dialog.portUnavailable.title", { port }),
    message: t(taken ? "native.dialog.portOccupied.message" : "native.dialog.portUnavailable.message", { port, code: probe.code }),
  });
  if (taken && response === 0 && (await killPort(port)).killed) {
    app.relaunch();
    app.exit(0);
    return false;
  }
  app.quit();
  return false;
}
