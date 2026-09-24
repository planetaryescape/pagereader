import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderPlayer } from "@/entrypoints/content/ReaderPlayer";

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/audio.ts", () => ({
  AudioPlayer: class MockAudioPlayer {
    constructor(_callbacks: unknown) {}
    setSpeed(_speed: number) {}
    setVoice(_voice: string) {}
    togglePlayPause() {}
    stop() {
      return Promise.resolve();
    }
    seekToSec(_sec: number) {
      return Promise.resolve();
    }
    play() {
      return Promise.resolve();
    }
    destroy() {}
  },
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/extractor.ts", () => ({
  extractPageContent: () => ({ textContent: "hello world" }),
  getReadableLength: () => "1 min read",
  hashContent: async () => "hash",
  canonicalizePageUrl: (url: string) => url,
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/highlighter.ts", () => ({
  clearHighlights: () => {},
  highlightChunk: () => {},
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

describe("ReaderPlayer quick site exclusion action", () => {
  it("shows button in floating mode and calls callback", () => {
    const onExcludeCurrentSite = vi.fn();

    render(
      <ReaderPlayer
        mode="floating"
        visible
        onVisibleChange={() => {}}
        currentHostname="example.com"
        onExcludeCurrentSite={onExcludeCurrentSite}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Don't show on this site" }));
    expect(onExcludeCurrentSite).toHaveBeenCalledTimes(1);
  });

  it("does not show button in docked mode", () => {
    render(<ReaderPlayer mode="docked" visible onVisibleChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Don't show on this site" })).toBeNull();
  });
});
