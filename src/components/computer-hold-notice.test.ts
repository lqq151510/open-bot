import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ComputerControl } from "../../server/computer-control";
import { publishComputerControl } from "../../server/computer-hold-broadcast";
import { handBackSharedHold } from "../../shared/computer-hold-view";
import { ComputerHoldNotice } from "./computer-hold-notice";

afterEach(() => {
  setLocale("en");
});

describe("shared computer hold on a member panel", () => {
  it("does not show this bot as the driver when someone else holds, and hand-back does not release that hold", async () => {
    setLocale("zh");
    const frames: Array<{ botId: string; held: boolean; heldByOther?: true }> = [];
    const revision = new Map<string, number>();
    const control = new ComputerControl((key, snapshot, holderBotId) => {
      publishComputerControl({
        key,
        snapshot,
        holderBotId,
        memberBotIds: key === "computer_desk" ? ["ant", "bee"] : [key],
        revision,
        desktop: () => {},
        broadcast: (frame) => {
          frames.push({
            botId: String(frame.botId),
            held: frame.held === true,
            ...(frame.heldByOther === true ? { heldByOther: true } : {}),
          });
        },
      });
    });

    control.take("computer_desk", "ant");
    const bee = frames.find((frame) => frame.botId === "bee");
    expect(frames.find((frame) => frame.botId === "ant")).toMatchObject({ held: true });
    expect(bee).toEqual({ botId: "bee", held: false, heldByOther: true });

    const html = renderToStaticMarkup(createElement(ComputerHoldNotice, {
      hold: { held: bee!.held, heldByOther: bee!.heldByOther },
      pending: false,
      aside: "",
      onHandBack: () => { throw new Error("hand back"); },
    }));
    expect(html).toContain("别人正在用");
    expect(html).not.toContain("由你控制");
    expect(html).not.toContain("现在由你操作");
    expect(html).not.toContain("交还控制");

    const releases: string[] = [];
    await handBackSharedHold({ held: bee!.held, heldByOther: bee!.heldByOther }, async () => {
      releases.push("release");
    });
    expect(releases).toEqual([]);
    expect(control.release("computer_desk", "bee").held).toBe(true);
    expect(control.holder("computer_desk")).toBe("ant");
  });
});
