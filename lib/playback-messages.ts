import type { PlaybackEngine } from "./storage";

export type StreamSessionState =
  | "idle"
  | "connecting"
  | "buffering"
  | "playing"
  | "paused"
  | "stopping"
  | "error";

export interface StreamGroup {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
}

export interface TranscriptLedgerEntry {
  groupId: number;
  startChar: number;
  endChar: number;
  sampleCount: number;
  durationSec: number;
}

export interface StartStreamMessage {
  action: "startStream";
  sessionId: string;
  text: string;
  apiKey: string;
  voice: string;
  speed: number;
  pageUrl: string;
  contentHash: string;
  cacheBudgetMb: number;
  playbackEngine: PlaybackEngine;
}

export interface PauseStreamMessage {
  action: "pauseStream";
  sessionId: string;
}

export interface ResumeStreamMessage {
  action: "resumeStream";
  sessionId: string;
}

export interface StopStreamMessage {
  action: "stopStream";
  sessionId?: string;
}

export interface SeekStreamMessage {
  action: "seekStream";
  sessionId: string;
  positionSec: number;
}

export interface SetStreamSpeedMessage {
  action: "setStreamSpeed";
  sessionId: string;
  speed: number;
}

export interface GetSessionStateMessage {
  action: "getSessionState";
  sessionId: string;
}

export interface StopForTabMessage {
  action: "stopForTab";
  tabId: number;
}

export type OffscreenControlMessage =
  | StartStreamMessage
  | PauseStreamMessage
  | ResumeStreamMessage
  | StopStreamMessage
  | SeekStreamMessage
  | SetStreamSpeedMessage
  | GetSessionStateMessage
  | StopForTabMessage;

export interface OffscreenCommandEnvelope {
  target: "offscreen";
  tabId?: number;
}

export interface OffscreenResponse {
  success: boolean;
  error?: string;
  snappedToSec?: number;
  state?: StreamSessionState;
}

export interface OffscreenEventMessage {
  source: "offscreen";
  event:
    | "state"
    | "phase"
    | "timeupdate"
    | "transcriptRange"
    | "warning"
    | "error"
    | "ended";
  sessionId: string;
  tabId?: number;
  state?: StreamSessionState;
  phase?: string;
  detail?: string;
  currentSec?: number;
  durationSec?: number;
  startChar?: number;
  endChar?: number;
  warning?: string;
  error?: string;
}
