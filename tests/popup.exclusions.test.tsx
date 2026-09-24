import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getExcludedSites, setApiKey } from "@/lib/storage";
import App from "@/entrypoints/popup/App";

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/deepgram.ts", () => ({
  validateApiKey: async () => true,
  VOICES: [
    { id: "aura-thalia-en", name: "Thalia", tier: "aura" },
    { id: "aura-2-thalia-en", name: "Thalia 2", tier: "aura-2" },
  ],
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/lib/cache.ts", () => ({
  getAudioCacheStats: async () => ({ totalBytes: 0, totalEntries: 0 }),
  clearAudioCache: async () => {},
}));

describe("Popup floating exclusions settings", () => {
  it("adds and removes excluded sites via settings", async () => {
    await setApiKey("test-api-key");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Site exclusions")).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("example.com or URL"), {
      target: { value: "https://Example.com/path?q=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(async () => {
      expect(screen.getByText("example.com")).toBeTruthy();
      expect(await getExcludedSites()).toEqual(["example.com"]);
    });

    const siteRow = screen.getByText("example.com").closest("div");
    expect(siteRow).toBeTruthy();
    fireEvent.click(within(siteRow as HTMLElement).getByRole("button", { name: "Remove" }));

    await waitFor(async () => {
      expect(screen.getByText("No excluded sites.")).toBeTruthy();
      expect(await getExcludedSites()).toEqual([]);
    });
  });
});
