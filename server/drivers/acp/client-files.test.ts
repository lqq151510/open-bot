import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runAcpClientFileRequest } from "./client-files.ts";

it("waits for one-shot approval before an ACP client write can take effect", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "omb-acp-file-"));
  try {
    const path = join(workspace, "draft.txt");
    await writeFile(path, "before");
    const current: Parameters<typeof runAcpClientFileRequest>[0]["current"] = {
      turn: {
        threadId: "isolated", text: "", approvalMode: "full", approvalRulesActive: () => true,
        approvalRuleForTool: ({ tool }) => tool === "fs/write_text_file",
      },
      asks: new Map(),
      flushAssistantText() {},
      state: { stopped: false, cancelling: false, settled: false },
    };
    const start = () => {
      let resolveOpened!: (requestId: string) => void;
      const opened = new Promise<string>(resolve => { resolveOpened = resolve; });
      const result = runAcpClientFileRequest({
        method: "fs/write_text_file", params: { path, content: "after" }, cwd: workspace, current,
        base: () => ({ eventId: "fixture", provider: "antigravity", threadId: "isolated", turnId: "turn", createdAt: new Date().toISOString() }),
        emit(event) {
          if (event.type !== "request.opened") return;
          expect(event).toMatchObject({ tool: "fs/write_text_file", alwaysAskRequired: true });
          resolveOpened(event.requestId!);
        },
      });
      return { opened, result };
    };
    const denied = start();
    const deniedId = await denied.opened;
    expect(await readFile(path, "utf8")).toBe("before");
    current.asks.get(deniedId)?.("deny");
    await expect(denied.result).rejects.toThrow("ACP file request was denied.");
    expect(await readFile(path, "utf8")).toBe("before");
    const allowed = start();
    current.asks.get(await allowed.opened)?.("allow");
    await expect(allowed.result).resolves.toEqual({});
    expect(await readFile(path, "utf8")).toBe("after");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
