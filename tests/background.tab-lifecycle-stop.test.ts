import { beforeEach, describe, expect, it, vi } from "vitest";

type ImportsMock = typeof import("@/tests/mocks/imports");

describe("background tab lifecycle stop forwarding", () => {
  let importsMock: ImportsMock;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("defineBackground", (setup: () => void) => setup());
    importsMock = await import("@/tests/mocks/imports");
    await import("@/entrypoints/background");
  });

  it("sends stopForTab on tab loading and tab removed", async () => {
    const sent: unknown[] = [];
    importsMock.__setRuntimeSendMessageHandler(async (message) => {
      sent.push(message);
      return { success: true };
    });

    importsMock.__emitTabUpdated(41, { status: "complete" });
    importsMock.__emitTabUpdated(41, { status: "loading" });
    importsMock.__emitTabRemoved(41);
    await Promise.resolve();

    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ target: "offscreen", action: "stopForTab", tabId: 41 });
    expect(sent[1]).toEqual({ target: "offscreen", action: "stopForTab", tabId: 41 });
  });

  it("does not throw when stopForTab forwarding fails", async () => {
    importsMock.__setRuntimeSendMessageHandler(async () => {
      throw new Error("tab not reachable");
    });

    expect(() => importsMock.__emitTabUpdated(9, { status: "loading" })).not.toThrow();
    expect(() => importsMock.__emitTabRemoved(9)).not.toThrow();
    await Promise.resolve();
  });
});
