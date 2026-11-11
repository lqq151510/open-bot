import { createServer } from "node:http";

type Binding = { slug: string; connectedAccountId: string; config: Record<string, unknown>; enabled: boolean; dropped: Record<string, { count: number; lastAt: number }> };

export async function startAppEventBrokerFixture() {
  const token = "a".repeat(64);
  const bindings = new Map<string, Binding>();
  const events: Array<{ seq: number; id: string; kind: string; triggerId: string | null; receivedAt: number; event: { data: Record<string, unknown> } }> = [];
  const type = { slug: "GMAIL_NEW_GMAIL_MESSAGE", toolkit: "gmail", name: "New Gmail message", description: "", type: "poll", config: {}, payload: {} };
  let queued = 0, expired = false, acknowledged = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized" })); }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/v1/connectors/connected") return res.end(JSON.stringify({ services: { gmail: { connected: !expired, accounts: [{ id: "fixture-account", alias: "sales", status: expired ? "EXPIRED" : "ACTIVE" }] } } }));
    if (url.pathname === "/v1/trigger-types/GMAIL_NEW_GMAIL_MESSAGE") return res.end(JSON.stringify(type));
    if (url.pathname === "/v1/trigger-types") return res.end(JSON.stringify({ toolkits: { gmail: { types: [type] } } }));
    if (url.pathname === "/v1/triggers" && req.method === "POST") {
      const triggerId = `fixture-trigger-${bindings.size + 1}`;
      bindings.set(triggerId, { ...body, enabled: true, dropped: {} });
      return res.end(JSON.stringify({ triggerId }));
    }
    if (url.pathname === "/v1/triggers" && req.method === "GET") return res.end(JSON.stringify({
      triggers: [...bindings].map(([triggerId, binding]) => ({ triggerId, ...binding, toolkit: "gmail", remote: { state: binding.enabled ? "enabled" : "disabled", config: binding.config } })),
      unbound: [], limits: { plan: "desktop", eventsPerDay: 500 }, usage: { eventsToday: queued },
    }));
    const bindingId = /^\/v1\/triggers\/([^/]+)$/.exec(url.pathname)?.[1];
    if (bindingId && bindings.has(bindingId)) {
      if (req.method === "PATCH") { bindings.get(bindingId)!.enabled = body.enabled; return res.end("{}"); }
      if (req.method === "DELETE") { bindings.delete(bindingId); return res.end("{}"); }
    }
    if (url.pathname === "/v1/events") {
      const after = Number(url.searchParams.get("after") ?? "0");
      acknowledged = Math.max(acknowledged, after);
      const ready = events.filter((event) => event.seq > after);
      if (!ready.length) await new Promise((resolve) => setTimeout(resolve, 100));
      return res.end(JSON.stringify({ events: ready, cursor: ready.at(-1)?.seq ?? after }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: `unknown fixture path ${url.pathname}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url, token, bindings,
    pending: () => events.filter((event) => event.seq > acknowledged).length,
    setQueuedToday(value: number) { queued = value; },
    expire() { expired = true; events.push({ seq: events.length + 1, id: `fixture-expired-${events.length + 1}`, kind: "account_expired", triggerId: null, receivedAt: Date.now(), event: { data: { connected_account_id: "fixture-account" } } }); },
    deliver(triggerId: string, data: Record<string, unknown>, id?: string) {
      const binding = bindings.get(triggerId);
      if (!binding) throw new Error("Unknown fixture trigger");
      if (!binding.enabled) return;
      if (queued >= 500) { const old = binding.dropped.daily_limit?.count ?? 0; binding.dropped.daily_limit = { count: old + 1, lastAt: Date.now() }; return; }
      queued += 1;
      const seq = events.length + 1;
      events.push({ seq, id: id ?? `fixture-event-${seq}`, kind: "message", triggerId, receivedAt: Date.now(), event: { data } });
    },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
