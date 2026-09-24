import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  addExcludedSite,
  getExcludedSites,
  removeExcludedSite,
  setPlayerMode,
  setPlayerVisible,
} from "@/lib/storage";
import { ReaderPlayerRoot } from "@/entrypoints/content/ReaderPlayerRoot";

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/entrypoints/content/FloatingWidget.tsx", () => ({
  FloatingWidget: ({
    onExcludeCurrentSite,
  }: {
    onExcludeCurrentSite?: () => void;
  }) => (
    <div data-testid="floating-widget">
      <button type="button" onClick={onExcludeCurrentSite}>
        exclude-current-site
      </button>
    </div>
  ),
}));

vi.mock("/Users/bhekanik/code/planetaryescape/pagereader/entrypoints/content/DockedPlayer.tsx", () => ({
  DockedPlayer: () => <div data-testid="docked-player" />,
}));

describe("ReaderPlayerRoot site exclusions", () => {
  it("hides floating widget when current host is excluded and shows it after removal", async () => {
    window.history.pushState({}, "", "/article");
    await setPlayerMode("floating");
    await setPlayerVisible(true);
    await addExcludedSite("example.com");

    const { container } = render(<ReaderPlayerRoot />);

    await waitFor(() => {
      expect(screen.queryByTestId("floating-widget")).toBeNull();
      expect(container.firstChild).toBeNull();
    });

    await removeExcludedSite("example.com");

    await waitFor(() => {
      expect(screen.getByTestId("floating-widget")).toBeTruthy();
    });
  });

  it("quick exclude action hides widget and persists hostname", async () => {
    window.history.pushState({}, "", "/story");
    await setPlayerMode("floating");
    await setPlayerVisible(true);

    render(<ReaderPlayerRoot />);

    await waitFor(() => {
      expect(screen.getByTestId("floating-widget")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "exclude-current-site" }));

    await waitFor(() => {
      expect(screen.queryByTestId("floating-widget")).toBeNull();
    });

    expect(await getExcludedSites()).toContain("example.com");
  });
});
