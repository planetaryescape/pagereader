import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderPlayer } from "@/entrypoints/content/ReaderPlayer";

const playSpy = vi.fn(() => new Promise<void>(() => {}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/audio.ts", () => ({
  AudioPlayer: class MockAudioPlayer {
    constructor(_callbacks: unknown) {}
    setSpeed(_speed: number) {}
    togglePlayPause() {}
    stop() {
      return Promise.resolve();
    }
    seekToSec(_sec: number) {
      return Promise.resolve();
    }
    play() {
      return playSpy();
    }
    destroy() {}
  },
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/extractor.ts", () => ({
  extractPageContent: () => ({ textContent: "hello world from article" }),
  getReadableLength: () => "4 words, ~1 min",
  hashContent: async () => "hash",
  canonicalizePageUrl: (url: string) => url,
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/highlighter.ts", () => ({
  clearHighlights: () => {},
  highlightChunk: () => ({ matched: true }),
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/deepgram.ts", () => ({
  VOICES: [{ id: "aura-2-thalia-en", name: "Thalia", tier: "aura-2" }],
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/storage.ts", () => ({
  getApiKey: async () => "test-key",
  getVoice: async () => "aura-2-thalia-en",
  setVoice: async () => {},
  getSpeed: async () => 1,
  setSpeed: async () => {},
  getWidgetPosition: async () => null,
  setWidgetPosition: async () => {},
  getAudioCacheBudgetMb: async () => 250,
  getPlaybackEngine: async () => "stable",
}));

describe("ReaderPlayer loading state UX", () => {
  it("shows immediate loading feedback and blocks duplicate startup clicks", async () => {
    render(<ReaderPlayer mode="floating" visible onVisibleChange={() => {}} />);

    const playButton = screen.getByRole("button", { name: /^Play$/i });
    fireEvent.click(playButton);
    fireEvent.click(playButton);

    const loadingButton = screen.getByRole("button", { name: /loading/i });
    expect(loadingButton.getAttribute("disabled")).not.toBeNull();
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalledTimes(1);
    });
  });
});
