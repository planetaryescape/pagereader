import { browser } from "#imports";
import { chunkText, synthesizeSpeech, DeepgramOptions } from "./deepgram";

export type PlaybackState = "idle" | "loading" | "playing" | "paused";

export interface AudioPlayerCallbacks {
  onStateChange: (state: PlaybackState) => void;
  onProgress: (current: number, total: number) => void;
  onError: (error: string) => void;
  onChunkChange: (chunkIndex: number) => void;
}

async function sendToOffscreen(data: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(
      { target: "background", action: "toOffscreen", data },
      resolve
    );
  });
}

export class AudioPlayer {
  private chunks: string[] = [];
  private currentChunkIndex = 0;
  private options: DeepgramOptions | null = null;
  private callbacks: AudioPlayerCallbacks;
  private state: PlaybackState = "idle";
  private speed = 1.0;
  private messageListener: ((message: unknown) => void) | null = null;

  constructor(callbacks: AudioPlayerCallbacks) {
    this.callbacks = callbacks;
    this.setupMessageListener();
  }

  private setupMessageListener() {
    this.messageListener = (message: unknown) => {
      const msg = message as { source?: string; event?: string; error?: string };
      console.log("[PageReader] Received message:", msg);
      if (msg.source !== "offscreen") return;
      console.log("[PageReader] Processing offscreen event:", msg.event);

      switch (msg.event) {
        case "ended":
          console.log("[PageReader] Chunk ended, state:", this.state);
          if (this.state === "playing") {
            this.playChunk(this.currentChunkIndex + 1);
          } else {
            console.log("[PageReader] Not continuing - state is not 'playing'");
          }
          break;
        case "error":
          this.callbacks.onError(msg.error || "Playback error");
          this.setState("idle");
          break;
        case "playing":
          this.setState("playing");
          break;
        case "paused":
          if (this.state !== "idle") {
            this.setState("paused");
          }
          break;
      }
    };
    browser.runtime.onMessage.addListener(this.messageListener);
  }

  async play(text: string, options: DeepgramOptions): Promise<void> {
    this.stop();
    this.options = options;
    this.chunks = chunkText(text);
    this.currentChunkIndex = 0;

    if (this.chunks.length === 0) {
      this.callbacks.onError("No text to read");
      return;
    }

    await this.playChunk(0);
  }

  private async playChunk(index: number): Promise<void> {
    if (index >= this.chunks.length || !this.options) {
      this.setState("idle");
      return;
    }

    this.currentChunkIndex = index;
    this.callbacks.onChunkChange(index);
    this.callbacks.onProgress(index, this.chunks.length);
    this.setState("loading");

    try {
      console.log("[PageReader] Synthesizing chunk", index, "text length:", this.chunks[index].length);
      const audioData = await synthesizeSpeech(
        this.chunks[index],
        this.options
      );
      console.log("[PageReader] Got audio data, size:", audioData.byteLength);

      // Convert ArrayBuffer to array for message passing
      const audioArray = Array.from(new Uint8Array(audioData));

      const response = await sendToOffscreen({
        action: "play",
        audioData: audioArray,
        speed: this.speed,
      }) as { success: boolean; error?: string };

      if (!response?.success) {
        throw new Error(response?.error || "Failed to play audio");
      }

      console.log("[PageReader] Playing chunk", index);
    } catch (err) {
      console.error("[PageReader] Playback error:", err);
      this.callbacks.onError(
        err instanceof Error ? err.message : "Failed to play audio"
      );
      this.setState("idle");
    }
  }

  pause(): void {
    if (this.state === "playing") {
      sendToOffscreen({ action: "pause" }).catch((err) => {
        console.error("[PageReader] Pause error:", err);
      });
    }
  }

  resume(): void {
    if (this.state === "paused") {
      sendToOffscreen({ action: "resume" }).catch((err) => {
        console.error("[PageReader] Resume error:", err);
      });
    }
  }

  togglePlayPause(): void {
    if (this.state === "playing") {
      this.pause();
    } else if (this.state === "paused") {
      this.resume();
    }
  }

  stop(): void {
    sendToOffscreen({ action: "stop" }).catch((err) => {
      console.error("[PageReader] Stop error:", err);
    });
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.setState("idle");
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    sendToOffscreen({ action: "setSpeed", speed }).catch((err) => {
      console.error("[PageReader] SetSpeed error:", err);
    });
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentChunk(): number {
    return this.currentChunkIndex;
  }

  getTotalChunks(): number {
    return this.chunks.length;
  }

  getChunks(): string[] {
    return this.chunks;
  }

  async seekTo(chunkIndex: number): Promise<void> {
    console.log("[PageReader] seekTo called:", chunkIndex, "total chunks:", this.chunks.length, "has options:", !!this.options);

    if (chunkIndex < 0 || chunkIndex >= this.chunks.length || !this.options) {
      console.log("[PageReader] seekTo aborted - invalid index or no options");
      this.callbacks.onError("Cannot seek - invalid position");
      return;
    }

    try {
      // Stop current playback
      await sendToOffscreen({ action: "stop" });

      // Small delay to ensure stop completes
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Play from the new chunk
      await this.playChunk(chunkIndex);
    } catch (err) {
      console.error("[PageReader] seekTo error:", err);
      this.callbacks.onError("Seek failed");
    }
  }

  private setState(state: PlaybackState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }
}
