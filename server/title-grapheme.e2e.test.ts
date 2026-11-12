import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("keeps emoji intact in a conversation title saved by the isolated server", async () => {
  const fixture = await launchVerificationServer({});
  try {
    const api = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(fixture.info.url + path, {
        method,
        headers: { origin: fixture.info.url, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(response.ok).toBe(true);
      return response.json();
    };
    const { bots } = await api("/api/bots") as { bots: Array<{ id: string }> };
    const emoji = "👩🏽‍💻";
    const title = `${"a".repeat(80 - emoji.length)}${emoji}`;
    const { task } = await api(`/api/bots/${bots[0]!.id}/tasks`, "POST", { title }) as { task: { title: string; threadId: string } };
    expect(task.title).toBe(title);
    const list = await api("/api/bots") as { bots: Array<{ id: string; tasks: Array<{ title: string; threadId: string }> }> };
    expect(list.bots.find((bot) => bot.id === bots[0]!.id)?.tasks.find((item) => item.threadId === task.threadId)?.title).toBe(task.title);
  } finally {
    await fixture.close();
  }
}, 30000);
