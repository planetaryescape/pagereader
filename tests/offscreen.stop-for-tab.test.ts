import { beforeEach, describe, expect, it, vi } from "vitest";

type ImportsMock = typeof import("@/tests/mocks/imports");

describe("offscreen stopForTab", () => {
  const sentEvents: Array<Record<string, unknown>> = [];
  let importsMock: ImportsMock;

  beforeEach(async () => {
    vi.resetModules();
    sentEvents.length = 0;

    class MockAudioWorkletNode {
      parameters = new Map(
        ["pitch", "tempo", "rate", "pitchSemitones", "playbackRate"].map((name) => [
          name,
          { value: 1 },
        ])
      );

      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
      };

      connect() {}
      disconnect() {}
    }

    class MockAudioContext {
      audioWorklet = {
        addModule: vi.fn(async () => {}),
      };

      destination = {};

      resume() {
        return Promise.resolve();
      }

      close() {
        return Promise.resolve();
      }
    }

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      binaryType = "arraybuffer";
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_url: string, _protocols?: string | string[]) {
        queueMicrotask(() => this.onopen?.());
      }

      send(_data: unknown) {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
      }
    }

    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
    vi.stubGlobal("WebSocket", MockWebSocket);

    importsMock = await import("@/tests/mocks/imports");
    importsMock.__setRuntimeSendMessageHandler(async (message) => {
      sentEvents.push(message as Record<string, unknown>);
      return { success: true };
    });
    await import("@/entrypoints/offscreen/main");
  });

  it("stops active playback context when tab matches", async () => {
    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "startStream",
      sessionId: "s1",
      tabId: 77,
      text: "hello there",
      apiKey: "k",
      voice: "v",
      speed: 1,
      pageUrl: "https://example.com",
      contentHash: "hash",
      cacheBudgetMb: 250,
      playbackEngine: "progressive",
    });

    sentEvents.length = 0;
    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "stopForTab",
      tabId: 77,
    });

    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "setStreamSpeed",
      sessionId: "s1",
      speed: 2,
    });

    const speedTimeUpdates = sentEvents.filter(
      (event) => event.source === "offscreen" && event.event === "timeupdate" && event.sessionId === "s1"
    );
    expect(speedTimeUpdates).toHaveLength(0);
  });

  it("keeps active playback context when tab id does not match", async () => {
    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "startStream",
      sessionId: "s2",
      tabId: 88,
      text: "hello there",
      apiKey: "k",
      voice: "v",
      speed: 1,
      pageUrl: "https://example.com",
      contentHash: "hash",
      cacheBudgetMb: 250,
      playbackEngine: "progressive",
    });

    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "stopForTab",
      tabId: 999,
    });

    sentEvents.length = 0;
    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "setStreamSpeed",
      sessionId: "s2",
      speed: 2,
    });

    const speedTimeUpdates = sentEvents.filter(
      (event) => event.source === "offscreen" && event.event === "timeupdate" && event.sessionId === "s2"
    );
    expect(speedTimeUpdates.length).toBeGreaterThan(0);

    await importsMock.__dispatchRuntimeMessage({
      target: "offscreen",
      action: "stopStream",
      sessionId: "s2",
    });
  });
});
