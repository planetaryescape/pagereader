import { useEffect, useState } from "react";
import { browser } from "#imports";
import { DockedPlayer } from "./DockedPlayer";
import { FloatingWidget } from "./FloatingWidget";
import {
  addExcludedSite,
  getPlayerMode,
  getPlayerVisible,
  isSiteExcluded,
  setPlayerVisible,
} from "@/lib/storage";

export function ReaderPlayerRoot() {
  const currentHostname = window.location.hostname.toLowerCase();
  const [mode, setMode] = useState<"docked" | "floating">("docked");
  const [visible, setVisible] = useState(true);
  const [excluded, setExcluded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const syncFromStorage = async () => {
      const [savedMode, savedVisible, savedExcluded] = await Promise.all([
        getPlayerMode(),
        getPlayerVisible(),
        isSiteExcluded(currentHostname),
      ]);

      if (!mounted) return;
      setMode(savedMode);
      setVisible(savedVisible);
      setExcluded(savedExcluded);
    };

    void syncFromStorage();

    const onStorageChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      _changes,
      areaName
    ) => {
      if (areaName !== "local") return;
      void syncFromStorage();
    };

    browser.storage.onChanged.addListener(onStorageChanged);

    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [currentHostname]);

  const handleVisibleChange = (nextVisible: boolean) => {
    setVisible(nextVisible);
    void setPlayerVisible(nextVisible);
  };

  const handleCloseForTab = () => {
    setDismissed(true);
  };

  const handleExcludeCurrentSite = () => {
    setExcluded(true);
    setDismissed(true);
    void addExcludedSite(currentHostname).catch((err) => {
      console.error("[PageReader] Failed to exclude current site:", err);
    });
  };

  if (!visible || excluded || dismissed) {
    return null;
  }

  if (mode === "floating") {
    return (
      <FloatingWidget
        visible={visible}
        onVisibleChange={handleVisibleChange}
        currentHostname={currentHostname}
        onExcludeCurrentSite={handleExcludeCurrentSite}
        onCloseForTab={handleCloseForTab}
      />
    );
  }

  return (
    <DockedPlayer
      visible={visible}
      onVisibleChange={handleVisibleChange}
      currentHostname={currentHostname}
      onExcludeCurrentSite={handleExcludeCurrentSite}
      onCloseForTab={handleCloseForTab}
    />
  );
}
