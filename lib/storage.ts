import { storage } from "#imports";

export type PlaybackEngine = "stable" | "progressive";

export interface StorageData {
  apiKey: string | null;
  voice: string;
  speed: number;
  playbackEngine: PlaybackEngine;
  playerMode: "docked" | "floating";
  playerVisible: boolean;
  audioCacheBudgetMb: number;
  widgetPosition: { x: number; y: number } | null;
  excludedSites: string[];
}

const DEFAULTS: StorageData = {
  apiKey: null,
  voice: "aura-2-thalia-en",
  speed: 1.0,
  playbackEngine: "progressive",
  playerMode: "docked",
  playerVisible: true,
  audioCacheBudgetMb: 250,
  widgetPosition: null,
  excludedSites: [],
};

export const apiKeyItem = storage.defineItem<string | null>("local:apiKey", {
  fallback: DEFAULTS.apiKey,
});

export const voiceItem = storage.defineItem<string>("local:voice", {
  fallback: DEFAULTS.voice,
});

export const speedItem = storage.defineItem<number>("local:speed", {
  fallback: DEFAULTS.speed,
});

export const playbackEngineItem = storage.defineItem<PlaybackEngine>(
  "local:playbackEngine",
  {
    fallback: DEFAULTS.playbackEngine,
  }
);

export const playerModeItem = storage.defineItem<"docked" | "floating">(
  "local:playerMode",
  {
    fallback: DEFAULTS.playerMode,
  }
);

export const playerVisibleItem = storage.defineItem<boolean>(
  "local:playerVisible",
  {
    fallback: DEFAULTS.playerVisible,
  }
);

export const audioCacheBudgetItem = storage.defineItem<number>(
  "local:audioCacheBudgetMb",
  {
    fallback: DEFAULTS.audioCacheBudgetMb,
  }
);

export const widgetPositionItem = storage.defineItem<{
  x: number;
  y: number;
} | null>("local:widgetPosition", {
  fallback: DEFAULTS.widgetPosition,
});

export const excludedSitesItem = storage.defineItem<string[]>("local:excludedSites", {
  fallback: DEFAULTS.excludedSites,
});

function sortUniqueSites(sites: string[]): string[] {
  return [...new Set(sites)].sort((a, b) => a.localeCompare(b));
}

export function normalizeSiteInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.trim().toLowerCase().replace(/\.+$/, "");
    if (!hostname) return null;
    return hostname;
  } catch {
    return null;
  }
}

export async function getApiKey(): Promise<string | null> {
  return apiKeyItem.getValue();
}

export async function setApiKey(key: string): Promise<void> {
  await apiKeyItem.setValue(key);
}

export async function getVoice(): Promise<string> {
  return voiceItem.getValue();
}

export async function setVoice(voice: string): Promise<void> {
  await voiceItem.setValue(voice);
}

export async function getSpeed(): Promise<number> {
  return speedItem.getValue();
}

export async function setSpeed(speed: number): Promise<void> {
  await speedItem.setValue(speed);
}

export async function getPlaybackEngine(): Promise<PlaybackEngine> {
  return playbackEngineItem.getValue();
}

export async function setPlaybackEngine(engine: PlaybackEngine): Promise<void> {
  await playbackEngineItem.setValue(engine);
}

export async function getPlayerMode(): Promise<"docked" | "floating"> {
  return playerModeItem.getValue();
}

export async function setPlayerMode(mode: "docked" | "floating"): Promise<void> {
  await playerModeItem.setValue(mode);
}

export async function getPlayerVisible(): Promise<boolean> {
  return playerVisibleItem.getValue();
}

export async function setPlayerVisible(visible: boolean): Promise<void> {
  await playerVisibleItem.setValue(visible);
}

export async function getAudioCacheBudgetMb(): Promise<number> {
  return audioCacheBudgetItem.getValue();
}

export async function setAudioCacheBudgetMb(budgetMb: number): Promise<void> {
  await audioCacheBudgetItem.setValue(budgetMb);
}

export async function getWidgetPosition(): Promise<{
  x: number;
  y: number;
} | null> {
  return widgetPositionItem.getValue();
}

export async function setWidgetPosition(pos: {
  x: number;
  y: number;
}): Promise<void> {
  await widgetPositionItem.setValue(pos);
}

export async function getExcludedSites(): Promise<string[]> {
  const sites = await excludedSitesItem.getValue();
  return sortUniqueSites(
    sites
      .map((site) => normalizeSiteInput(site))
      .filter((site): site is string => !!site)
  );
}

export async function addExcludedSite(input: string): Promise<string[]> {
  const site = normalizeSiteInput(input);
  if (!site) {
    return getExcludedSites();
  }

  const current = await getExcludedSites();
  const next = sortUniqueSites([...current, site]);
  await excludedSitesItem.setValue(next);
  return next;
}

export async function removeExcludedSite(hostname: string): Promise<string[]> {
  const normalized = normalizeSiteInput(hostname);
  if (!normalized) {
    return getExcludedSites();
  }

  const current = await getExcludedSites();
  const next = current.filter((site) => site !== normalized);
  await excludedSitesItem.setValue(next);
  return next;
}

export async function isSiteExcluded(hostname: string): Promise<boolean> {
  const normalized = normalizeSiteInput(hostname);
  if (!normalized) {
    return false;
  }

  const sites = await getExcludedSites();
  return sites.includes(normalized);
}
