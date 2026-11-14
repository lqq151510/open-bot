import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { ensureServerPort, killPort, probePort } from "./port-utils.mjs";

const HOLDER = [
  'const net = require("node:net");',
  'const server = net.createServer((socket) => socket.end());',
  'server.listen({ host: "127.0.0.1", port: Number(process.argv[1]) }, () => console.log("ready"));',
].join("\n");

function listenOn(host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ host, port: 0, exclusive: true }, () => resolve({ server, port: server.address().port }));
  });
}

async function freePort() {
  const { server, port } = await listenOn("127.0.0.1");
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function spawnHolder(port) {
  return spawn(process.execPath, ["-e", HOLDER, String(port)], { stdio: ["ignore", "pipe", "ignore"] });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk) => {
      if (String(chunk).includes("ready")) resolve();
      else reject(new Error(`unexpected child output: ${String(chunk)}`));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

test("reports a free port as free", async () => {
  const port = await freePort();
  assert.deepEqual(await probePort(port), { free: true });
});

test("detects a listener bound only to loopback", async (t) => {
  const { server, port } = await listenOn("127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.deepEqual(await probePort(port), { free: false, code: "EADDRINUSE" });
});

test("detects a listener bound to the wildcard address", async (t) => {
  const { server, port } = await listenOn("0.0.0.0");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.deepEqual(await probePort(port), { free: false, code: "EADDRINUSE" });
});

test("rejects ports outside the usable range", async () => {
  for (const port of [0, 65536, -1, 8799.5, "8799", undefined]) {
    await assert.rejects(() => probePort(port), RangeError);
    await assert.rejects(() => killPort(port), RangeError);
  }
});

test("reports no pids when nothing is listening", async () => {
  const port = await freePort();
  assert.deepEqual(await killPort(port), { killed: false, pids: [] });
});

test("stops the process listening on the port", async (t) => {
  const port = await freePort();
  const child = spawnHolder(port);
  t.after(() => child.kill("SIGKILL"));
  await waitForReady(child);

  const result = await killPort(port);
  assert.equal(result.killed, true);
  assert.deepEqual(result.pids, [child.pid]);

  await waitForExit(child);
  await delay(100);
  assert.deepEqual(await probePort(port), { free: true });
});

function fakeApp() {
  const calls = [];
  return {
    calls,
    relaunch: () => calls.push("relaunch"),
    exit: (code) => calls.push(`exit:${code}`),
    quit: () => calls.push("quit"),
  };
}

function fakeDialog(answer) {
  const shown = [];
  return {
    shown,
    showMessageBox: async (options) => {
      shown.push(options);
      return { response: answer };
    },
  };
}

const translate = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

test("starts when nothing holds the port", async () => {
  const port = await freePort();
  const app = fakeApp();
  const dialog = fakeDialog(0);

  assert.equal(await ensureServerPort({ port, app, dialog, t: translate }), true);
  assert.deepEqual(dialog.shown, []);
  assert.deepEqual(app.calls, []);
});

test("refuses to start when the port is held and the person closes the dialog", async (t) => {
  const { server, port } = await listenOn("0.0.0.0");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const app = fakeApp();
  const dialog = fakeDialog(1);

  assert.equal(await ensureServerPort({ port, app, dialog, t: translate }), false);
  assert.deepEqual(dialog.shown[0].buttons, ["native.dialog.portOccupied.restart", "native.role.quit"]);
  assert.equal(dialog.shown[0].defaultId, 1);
  assert.deepEqual(app.calls, ["quit"]);
});

test("stops the program holding the port and relaunches", async (t) => {
  const port = await freePort();
  const child = spawnHolder(port);
  t.after(() => child.kill("SIGKILL"));
  await waitForReady(child);
  const app = fakeApp();
  const dialog = fakeDialog(0);

  assert.equal(await ensureServerPort({ port, app, dialog, t: translate }), false);
  assert.deepEqual(app.calls, ["relaunch", "exit:0"]);
  await waitForExit(child);
});
