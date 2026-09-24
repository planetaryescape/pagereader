import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __emitRuntimeMessage } from "@/tests/mocks/imports";
import type { AudioPlayerCallbacks, PlayOptions } from "@/lib/audio";
import { AudioPlayer } from "@/lib/audio";

const mockSendToOffscreen = vi.fn();

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/offscreen-client.ts", () => ({
  sendToOffscreen: (...args: unknown[]) => mockSendToOffscreen(...args),
}));

function makeCallbacks(phases: string[], errors: string[] = []): AudioPlayerCallbacks {
  return {
    onStateChange: () => {},
    onPhaseChange: (phase) => phases.push(phase),
    onProgress: () => {},
    onError: (message) => errors.push(message),
    onWarning: () => {},
    onTranscriptRange: () => {},
  };
}

function makeOptions(): PlayOptions {
  return {
    apiKey: "k",
    voice: "v",
    speed: 1,
    pageUrl: "https://example.com/x",
    contentHash: "hash",
    cacheBudgetMb: 250,
    playbackEngine: "progressive",
  };
}

describe("AudioPlayer phase callbacks", () => {
  beforeEach(() => {
    mockSendToOffscreen.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits preparing/connecting/buffering/playing for streaming startup", async () => {
    mockSendToOffscreen.mockResolvedValue({ success: true });

    const phases: string[] = [];
    const player = new AudioPlayer(makeCallbacks(phases));

    await player.play("hello world", makeOptions());

    const startPayload = mockSendToOffscreen.mock.calls.find(
      ([payload]) => payload.action === "startStream"
    )?.[0];
    expect(startPayload).toBeTruthy();

    __emitRuntimeMessage({
      source: "offscreen",
      event: "state",
      sessionId: startPayload.sessionId,
      state: "buffering",
    });
    __emitRuntimeMessage({
      source: "offscreen",
      event: "state",
      sessionId: startPayload.sessionId,
      state: "playing",
    });

    const preparingIndex = phases.indexOf("preparing");
    const connectingIndex = phases.indexOf("connecting");
    const bufferingIndex = phases.indexOf("buffering");
    const playingIndex = phases.indexOf("playing");

    expect(preparingIndex).toBeGreaterThanOrEqual(0);
    expect(connectingIndex).toBeGreaterThan(preparingIndex);
    expect(bufferingIndex).toBeGreaterThan(connectingIndex);
    expect(playingIndex).toBeGreaterThan(bufferingIndex);
  });

  it("emits error phase when offscreen startup fails", async () => {
    mockSendToOffscreen.mockResolvedValue({ success: false, error: "stream failed" });

    const phases: string[] = [];
    const errors: string[] = [];
    const player = new AudioPlayer(makeCallbacks(phases, errors));

    await player.play("broken", makeOptions());

    expect(errors).toContain("stream failed");
    expect(phases).toContain("error");
  });

  it("restarts playback from the current position when resume loses the offscreen session", async () => {
    mockSendToOffscreen.mockImplementation(async (payload: { action: string }) => {
      if (payload.action === "resumeStream") {
        return { success: false, error: "Session not found" };
      }
      if (payload.action === "seekStream") {
        return { success: true, snappedToSec: 5 };
      }
      return { success: true };
    });

    const player = new AudioPlayer(makeCallbacks([]));
    await player.play("hello world", makeOptions());

    const firstStartPayload = mockSendToOffscreen.mock.calls.find(
      ([payload]) => payload.action === "startStream"
    )?.[0];
    expect(firstStartPayload).toBeTruthy();

    __emitRuntimeMessage({
      source: "offscreen",
      event: "timeupdate",
      sessionId: firstStartPayload.sessionId,
      currentSec: 5,
      durationSec: 20,
    });
    __emitRuntimeMessage({
      source: "offscreen",
      event: "state",
      sessionId: firstStartPayload.sessionId,
      state: "paused",
    });

    player.resume();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const startCalls = mockSendToOffscreen.mock.calls.filter(
        ([payload]) => payload.action === "startStream"
      );
      if (startCalls.length === 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const startCalls = mockSendToOffscreen.mock.calls.filter(
      ([payload]) => payload.action === "startStream"
    );
    expect(startCalls).toHaveLength(2);

    const restartedSessionId = startCalls[1]?.[0]?.sessionId;
    __emitRuntimeMessage({
      source: "offscreen",
      event: "state",
      sessionId: restartedSessionId,
      state: "playing",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const seekCall = mockSendToOffscreen.mock.calls.find(
      ([payload]) => payload.action === "seekStream"
    )?.[0];
    expect(seekCall).toEqual(
      expect.objectContaining({
        action: "seekStream",
        positionSec: 5,
      })
    );
  });

  it("restarts playback from the current position when resume hangs in loading", async () => {
    vi.useFakeTimers();
    mockSendToOffscreen.mockImplementation(async (payload: { action: string }) => {
      if (payload.action === "resumeStream") {
        return new Promise(() => {});
      }
      if (payload.action === "seekStream") {
        return { success: true, snappedToSec: 7 };
      }
      return { success: true };
    });

    const player = new AudioPlayer(makeCallbacks([]));
    await player.play("hello world", makeOptions());

    const firstStartPayload = mockSendToOffscreen.mock.calls.find(
      ([payload]) => payload.action === "startStream"
    )?.[0];
    expect(firstStartPayload).toBeTruthy();

    __emitRuntimeMessage({
      source: "offscreen",
      event: "timeupdate",
      sessionId: firstStartPayload.sessionId,
      currentSec: 7,
      durationSec: 20,
    });
    __emitRuntimeMessage({
      source: "offscreen",
      event: "state",
      sessionId: firstStartPayload.sessionId,
      state: "paused",
    });

    player.resume();
    await vi.advanceTimersByTimeAsync(3600);

    const startCalls = mockSendToOffscreen.mock.calls.filter(
      ([payload]) => payload.action === "startStream"
    );
    expect(startCalls).toHaveLength(2);

    const restartedSessionId = startCalls[1]?.[0]?.sessionId;
    __emitRuntimeMessage({
      source: "offscreen",
      event: "state",
      sessionId: restartedSessionId,
      state: "playing",
    });
    await vi.advanceTimersByTimeAsync(0);

    const seekCall = mockSendToOffscreen.mock.calls.find(
      ([payload]) => payload.action === "seekStream"
    )?.[0];
    expect(seekCall).toEqual(
      expect.objectContaining({
        action: "seekStream",
        positionSec: 7,
      })
    );

  });
});
