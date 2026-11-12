import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";

let server: Server | undefined;
let dataDir = "";
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
  vi.unstubAllEnvs();
});

it("sends private meeting config through a loopback upload service", async () => {
  let base = "";
  let payload = "";
  let requestedPath = "";
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    const body = Buffer.concat(chunks).toString("utf8");
    if (req.method === "POST" && req.url === "/api/v1/sandboxes/bx_23456789/files/upload-url") {
      requestedPath = (JSON.parse(body) as { path: string }).path;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, url: `${base}/upload`, method: "PUT", path: requestedPath }));
    } else if (req.method === "PUT" && req.url === "/upload") {
      payload = body;
      res.writeHead(200).end();
    } else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture unavailable");
  base = `http://127.0.0.1:${address.port}`;
  dataDir = mkdtempSync(join(tmpdir(), "openbot-private-upload-test-"));
  vi.stubEnv("OMB_DATA_DIR", dataDir);
  vi.stubEnv("OMB_BOAT_API", `${base}/api/v1`);
  vi.stubEnv("OMB_CLOUD_BOAT_URL", "");
  vi.stubEnv("OMB_CLOUD_BOAT_TOKEN", "");
  vi.resetModules();
  const { uploadMeetingPrivate } = await import("./meetings-host.ts");
  const config = { box: { token: "fixture-token" } } as AppConfig;
  const contents = JSON.stringify({ url: "https://meet.google.com/abc-defg-hij?pwd=fixture-password", token: "fixture-one-time-token" });
  const target = "/home/user/.openbot-meet/m-12345678/config-test.tmp";
  await uploadMeetingPrivate(config, "bx_23456789", target, contents);
  expect(requestedPath).toBe(target);
  expect(payload).toBe(contents);
});
