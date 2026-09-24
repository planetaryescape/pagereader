import { describe, expect, it, vi } from "vitest";
import { __emitRuntimeMessage } from "@/tests/mocks/imports";
import { AudioPlayer } from "@/lib/audio";

const mockSendToOffscreen = vi.fn();

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/offscreen-client.ts", () => ({
  sendToOffscreen: (...args: unknown[]) => mockSendToOffscreen(...args),
}));

describe("AudioPlayer transcript progression", () => {
  it("emits advancing transcript ranges from offscreen stream events and forwards speed changes", async () => {
    mockSendToOffscreen.mockResolvedValue({ success: true });

    const ranges: Array<[number, number]> = [];
    const player = new AudioPlayer({
      onStateChange: () => {},
      onPhaseChange: () => {},
      onProgress: () => {},
      onError: () => {},
      onWarning: () => {},
      onTranscriptRange: (start, end) => ranges.push([start, end]),
    });

    await player.play("hello world from stream", {
      apiKey: "k",
      voice: "v",
      speed: 1,
      pageUrl: "https://example.com",
      contentHash: "h",
      cacheBudgetMb: 250,
      playbackEngine: "progressive",
    });

    const startPayload = mockSendToOffscreen.mock.calls.find(
      ([payload]) => payload.action === "startStream"
    )?.[0];
    expect(startPayload).toBeTruthy();

    player.setSpeed(2);

    __emitRuntimeMessage({
      source: "offscreen",
      event: "transcriptRange",
      sessionId: startPayload.sessionId,
      startChar: 0,
      endChar: 9,
    });
    __emitRuntimeMessage({
      source: "offscreen",
      event: "transcriptRange",
      sessionId: startPayload.sessionId,
      startChar: 10,
      endChar: 20,
    });
    __emitRuntimeMessage({
      source: "offscreen",
      event: "transcriptRange",
      sessionId: startPayload.sessionId,
      startChar: 21,
      endChar: 31,
    });
    __emitRuntimeMessage({
      source: "offscreen",
      event: "transcriptRange",
      sessionId: startPayload.sessionId,
      startChar: 32,
      endChar: 39,
    });

    const uniqueRanges = [...new Set(ranges.map((range) => `${range[0]}:${range[1]}`))];
    expect(uniqueRanges.length).toBeGreaterThanOrEqual(4);
    expect(mockSendToOffscreen).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "setStreamSpeed",
        sessionId: startPayload.sessionId,
        speed: 2,
      })
    );
  });
});
