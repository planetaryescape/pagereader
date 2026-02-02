import { storage } from "#imports";

export interface StorageData {
  apiKey: string | null;
  voice: string;
  speed: number;
  widgetPosition: { x: number; y: number } | null;
}

const DEFAULTS: StorageData = {
  apiKey: null,
  voice: "aura-asteria-en",
  speed: 1.0,
  widgetPosition: null,
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

export const widgetPositionItem = storage.defineItem<{
  x: number;
  y: number;
} | null>("local:widgetPosition", {
  fallback: DEFAULTS.widgetPosition,
});

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
