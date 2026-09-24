import { browser } from "#imports";
import { sendToOffscreen } from "./offscreen-client";
import {
  OffscreenEventMessage,
  OffscreenResponse,
  StreamSessionState,
} from "./playback-messages";
import type { PlaybackEngine } from "./storage";

export type PlaybackState = "idle" | "loading" | "playing" | "paused";
export type PlaybackPhase =
  | "idle"
  | "preparing"
  | "connecting"
  | "buffering"
  | "playing"
  | "paused"
  | "stopping"
  | "error";

export interface AudioPlayerCallbacks {
  onStateChange: (state: PlaybackState) => void;
  onPhaseChange: (phase: PlaybackPhase, detail?: string) => void;
  onProgress: (currentSec: number, totalSec: number) => void;
  onError: (error: string) => void;
  onWarning: (warning: string) => void;
  onTranscriptRange: (startChar: number, endChar: number) => void;
}

export interface PlayOptions {
  apiKey: string;
  voice: string;
  speed: number;
  pageUrl: string;
  contentHash: string;
  cacheBudgetMb: number;
  playbackEngine?: PlaybackEngine;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPlaybackState(state: StreamSessionState): PlaybackState {
  switch (state) {
    case "playing":
      return "playing";
    case "paused":
      return "paused";
    case "connecting":
    case "buffering":
    case "stopping":
      return "loading";
    case "error":
    case "idle":
    default:
      return "idle";
  }
}

function toPlaybackPhase(state: StreamSessionState): PlaybackPhase {
  switch (state) {
    case "connecting":
      return "connecting";
    case "buffering":
      return "buffering";
    case "playing":
      return "playing";
    case "paused":
      return "paused";
    case "stopping":
      return "stopping";
    case "error":
      return "error";
    case "idle":
    default:
      return "idle";
  }
}

export class AudioPlayer {
  private static readonly RESUME_RECOVERY_TIMEOUT_MS = 3500;

  private callbacks: AudioPlayerCallbacks;
  private state: PlaybackState = "idle";
  private phase: PlaybackPhase = "idle";
  private speed = 1;
  private sessionId = "";
  private totalSec = 0;
  private currentSec = 0;
  private pendingSeekSec: number | null = null;
  private lastText = "";
  private lastOptions: PlayOptions | null = null;
  private resumeRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private isRecovering = false;
  private messageListener: ((message: unknown) => void) | null = null;

  constructor(callbacks: AudioPlayerCallbacks) {
    this.callbacks = callbacks;
    this.setupMessageListener();
    this.setPhase("idle");
  }

  private setupMessageListener(): void {
    this.messageListener = (message: unknown) => {
      const msg = message as OffscreenEventMessage;
      if (msg.source !== "offscreen") return;
      if (!msg.sessionId || msg.sessionId !== this.sessionId) return;

      switch (msg.event) {
        case "state":
          if (msg.state) {
            this.handleState(msg.state, msg.detail);
          }
          break;
        case "phase":
          if (typeof msg.phase === "string") {
            const phase = msg.phase as PlaybackPhase;
            this.setPhase(phase, msg.detail);
          }
          break;
        case "timeupdate":
          this.currentSec = Math.max(0, Number(msg.currentSec || 0));
          this.totalSec = Math.max(this.currentSec, Number(msg.durationSec || 0));
          if (this.currentSec > 0) {
            this.clearResumeRecoveryTimer();
          }
          this.callbacks.onProgress(this.currentSec, this.totalSec);
          break;
        case "transcriptRange":
          if (typeof msg.startChar === "number" && typeof msg.endChar === "number") {
            this.callbacks.onTranscriptRange(msg.startChar, msg.endChar);
          }
          break;
        case "warning":
          if (msg.warning) {
            this.callbacks.onWarning(msg.warning);
          }
          break;
        case "error":
          this.callbacks.onError(msg.error || "Playback failed");
          this.setPhase("error", msg.error || "Playback failed");
          this.setState("idle", false);
          break;
        case "ended":
          this.callbacks.onProgress(0, this.totalSec);
          this.setState("idle");
          break;
      }
    };

    browser.runtime.onMessage.addListener(this.messageListener);
  }

  private handleState(nextState: StreamSessionState, detail?: string): void {
    if (nextState === "playing" || nextState === "paused" || nextState === "idle" || nextState === "error") {
      this.clearResumeRecoveryTimer();
    }

    this.setPhase(toPlaybackPhase(nextState), detail);
    this.setState(toPlaybackState(nextState), false);
    if (nextState === "playing" && this.pendingSeekSec !== null) {
      const pendingSeekSec = this.pendingSeekSec;
      this.pendingSeekSec = null;
      void this.seekToSec(pendingSeekSec);
    }
  }

  async play(text: string, options: PlayOptions): Promise<void> {
    await this.stop();
    this.setPhase("preparing", "Preparing audio...");

    const trimmed = text.trim();
    if (!trimmed) {
      this.callbacks.onError("No text to read");
      this.setPhase("error", "No text to read");
      this.setState("idle", false);
      return;
    }

    this.sessionId = randomId();
    this.speed = options.speed || 1;
    this.lastText = trimmed;
    this.lastOptions = { ...options };
    this.currentSec = 0;
    this.totalSec = 0;
    this.pendingSeekSec = null;
    this.setState("loading", false);
    this.setPhase("connecting", "Connecting to speech stream...");

    const response = (await sendToOffscreen<OffscreenResponse>({
      action: "startStream",
      sessionId: this.sessionId,
      text: trimmed,
      apiKey: options.apiKey,
      voice: options.voice,
      speed: this.speed,
      pageUrl: options.pageUrl,
      contentHash: options.contentHash,
      cacheBudgetMb: options.cacheBudgetMb,
      playbackEngine: options.playbackEngine || "progressive",
    })) as OffscreenResponse;

    if (!response?.success) {
      const message = response?.error || "Failed to start playback";
      this.callbacks.onError(message);
      this.setPhase("error", message);
      this.setState("idle", false);
      this.sessionId = "";
      return;
    }
  }

  pause(): void {
    if (!this.sessionId || this.state !== "playing") return;

    this.setPhase("paused", "Playback paused.");
    this.setState("paused", false);
    void sendToOffscreen<OffscreenResponse>({
      action: "pauseStream",
      sessionId: this.sessionId,
    })
      .then((response) => {
        if (!response?.success) {
          this.clearResumeRecoveryTimer();
          this.setState("idle");
        }
      })
      .catch((err) => {
        console.error("[PageReader] Pause error:", err);
      });
  }

  resume(): void {
    if (!this.sessionId || this.state !== "paused") return;

    this.setPhase("buffering", "Resuming playback...");
    this.setState("loading", false);
    const resumeFromSec = this.currentSec;
    this.scheduleResumeRecovery(this.sessionId, resumeFromSec);
    void sendToOffscreen<OffscreenResponse>({
      action: "resumeStream",
      sessionId: this.sessionId,
    })
      .then(async (response) => {
        if (response?.success) return;
        this.clearResumeRecoveryTimer();
        await this.restartFromPosition(resumeFromSec);
      })
      .catch(async (err) => {
        console.error("[PageReader] Resume error:", err);
        this.clearResumeRecoveryTimer();
        await this.restartFromPosition(resumeFromSec);
      });
  }

  togglePlayPause(): void {
    if (this.state === "playing") {
      this.pause();
      return;
    }

    if (this.state === "paused") {
      this.resume();
    }
  }

  async stop(): Promise<void> {
    const activeSession = this.sessionId;

    this.clearResumeRecoveryTimer();
    this.sessionId = "";
    this.currentSec = 0;
    this.totalSec = 0;
    this.pendingSeekSec = null;

    if (activeSession) {
      await sendToOffscreen({
        action: "stopStream",
        sessionId: activeSession,
      }).catch((err) => {
        console.error("[PageReader] Stop error:", err);
      });
    }

    this.callbacks.onProgress(0, 0);
    this.setState("idle");
  }

  setSpeed(speed: number): void {
    this.speed = speed;

    if (!this.sessionId) return;

    void sendToOffscreen({
      action: "setStreamSpeed",
      sessionId: this.sessionId,
      speed,
    }).catch((err) => {
      console.error("[PageReader] SetSpeed error:", err);
    });
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.currentSec;
  }

  getDuration(): number {
    return this.totalSec;
  }

  async seekToSec(positionSec: number): Promise<void> {
    if (!this.sessionId) return;

    const target = clamp(positionSec, 0, this.totalSec || positionSec);
    if (this.state === "loading") {
      this.pendingSeekSec = target;
      return;
    }

    const response = await sendToOffscreen<OffscreenResponse>({
      action: "seekStream",
      sessionId: this.sessionId,
      positionSec: target,
    });

    if (!response?.success) {
      await this.restartFromPosition(target);
      return;
    }

    const snappedToSec =
      response && typeof response === "object" && "snappedToSec" in response
        ? Number((response as OffscreenResponse).snappedToSec || target)
        : target;

    this.currentSec = snappedToSec;
    this.callbacks.onProgress(this.currentSec, this.totalSec);
  }

  destroy(): void {
    this.clearResumeRecoveryTimer();
    if (this.messageListener) {
      browser.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }
    void this.stop();
  }

  private setState(state: PlaybackState, syncPhase = true): void {
    this.state = state;
    this.callbacks.onStateChange(state);
    if (!syncPhase) return;
    if (state === "playing") {
      this.setPhase("playing");
      return;
    }
    if (state === "paused") {
      this.setPhase("paused");
      return;
    }
    if (state === "idle") {
      this.setPhase("idle");
    }
  }

  private setPhase(phase: PlaybackPhase, detail?: string): void {
    this.phase = phase;
    this.callbacks.onPhaseChange(phase, detail);
  }

  private scheduleResumeRecovery(sessionId: string, positionSec: number): void {
    this.clearResumeRecoveryTimer();
    this.resumeRecoveryTimer = setTimeout(() => {
      if (this.sessionId !== sessionId) return;
      if (this.state !== "loading") return;
      void this.restartFromPosition(positionSec);
    }, AudioPlayer.RESUME_RECOVERY_TIMEOUT_MS);
  }

  private clearResumeRecoveryTimer(): void {
    if (!this.resumeRecoveryTimer) return;
    clearTimeout(this.resumeRecoveryTimer);
    this.resumeRecoveryTimer = null;
  }

  private async restartFromPosition(positionSec: number): Promise<void> {
    if (this.isRecovering) return;
    if (!this.lastText || !this.lastOptions) return;

    this.isRecovering = true;
    this.clearResumeRecoveryTimer();
    try {
      const options = { ...this.lastOptions, speed: this.speed };
      await this.play(this.lastText, options);
      if (positionSec > 0) {
        await this.seekToSec(positionSec);
      }
    } finally {
      this.isRecovering = false;
    }
  }
}
