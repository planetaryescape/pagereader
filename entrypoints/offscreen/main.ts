import { browser } from "#imports";
import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import soundTouchProcessorUrl from "@soundtouchjs/audio-worklet/processor?url";
import { DEEPGRAM_MODEL_VERSION } from "@/lib/deepgram";
import { encodePcm16ToWav } from "@/lib/audio-merge";
import { AudioCacheKey, getCachedAudio, putCachedAudio } from "@/lib/cache";
import {
  OffscreenControlMessage,
  OffscreenEventMessage,
  OffscreenResponse,
  StartStreamMessage,
  StreamSessionState,
  TranscriptLedgerEntry,
} from "@/lib/playback-messages";
import {
  buildGroupHighlightSlices,
  buildStreamGroups,
  getDurationEstimate,
  resolveGroupTarget,
  resolveTranscriptRange,
} from "@/lib/stream-groups";
import type { StreamGroup } from "@/lib/playback-messages";

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const LOW_BUFFER_SECONDS = 2.5;
const KEEP_ALIVE_MS = 5000;
const SOUND_TOUCH_PIPELINE_LATENCY_SEC = 0.08;

interface OutputStats {
  playedSourceFrames: number;
  bufferedSourceFrames: number;
}

interface PcmOutput {
  appendPcm(samples: Int16Array): void;
  setPaused(paused: boolean): void;
  setPlaybackRate(rate: number): void;
  getLastStats(): OutputStats;
  getLatencySec(): number;
  destroy(): Promise<void>;
}

function buildCacheKey(params: StartStreamMessage): AudioCacheKey {
  return {
    url: params.pageUrl,
    contentHash: params.contentHash,
    voice: params.voice,
    speed: params.speed || 1,
    modelVersion: DEEPGRAM_MODEL_VERSION,
  };
}

function sendEvent(
  sessionId: string,
  tabId: number | undefined,
  payload: Omit<OffscreenEventMessage, "source" | "sessionId" | "tabId">
) {
  browser.runtime
    .sendMessage({
      source: "offscreen",
      sessionId,
      tabId,
      ...payload,
    } satisfies OffscreenEventMessage)
    .catch((err) => {
      console.error("[Offscreen] Failed to send event:", payload.event, err);
    });
}

function concatInt16Arrays(chunks: Int16Array[]): Int16Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function toInt16Array(data: ArrayBuffer): Int16Array {
  return new Int16Array(data.slice(0));
}

function describeStreamError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Playback failed";
}

class WorkletPcmOutput implements PcmOutput {
  private context: AudioContext;
  private sourceNode: AudioWorkletNode;
  private soundTouchNode: SoundTouchNode;
  private stats: OutputStats = {
    playedSourceFrames: 0,
    bufferedSourceFrames: 0,
  };

  private constructor(
    context: AudioContext,
    sourceNode: AudioWorkletNode,
    soundTouchNode: SoundTouchNode,
    onStats: (stats: OutputStats) => void
  ) {
    this.context = context;
    this.sourceNode = sourceNode;
    this.soundTouchNode = soundTouchNode;
    this.sourceNode.port.onmessage = (event) => {
      if (event.data?.type !== "stats") return;
      this.stats = {
        playedSourceFrames: Number(event.data.playedSourceFrames || 0),
        bufferedSourceFrames: Number(event.data.bufferedSourceFrames || 0),
      };
      onStats(this.stats);
    };
  }

  static async create(onStats: (stats: OutputStats) => void): Promise<WorkletPcmOutput> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await Promise.all([
      context.audioWorklet.addModule(new URL("/pcm-worklet.js", window.location.origin).toString()),
      SoundTouchNode.register(context, soundTouchProcessorUrl),
    ]);
    const sourceNode = new AudioWorkletNode(context, "pcm-stream-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const soundTouchNode = new SoundTouchNode(context);
    sourceNode.connect(soundTouchNode);
    soundTouchNode.connect(context.destination);
    await context.resume();
    return new WorkletPcmOutput(context, sourceNode, soundTouchNode, onStats);
  }

  appendPcm(samples: Int16Array): void {
    const floatSamples = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      floatSamples[index] = samples[index] / 32768;
    }
    this.sourceNode.port.postMessage({ type: "append", samples: floatSamples.buffer }, [
      floatSamples.buffer,
    ]);
  }

  setPaused(paused: boolean): void {
    this.sourceNode.port.postMessage({ type: "setPaused", paused });
    if (paused) {
      void this.context.suspend();
      return;
    }
    if (this.context.state !== "running") {
      void this.context.resume();
    }
  }

  setPlaybackRate(rate: number): void {
    const clampedRate = Math.max(0.5, Math.min(2, rate));
    this.sourceNode.port.postMessage({ type: "setPlaybackRate", playbackRate: clampedRate });
    this.soundTouchNode.playbackRate.value = clampedRate;
    this.soundTouchNode.pitch.value = 1;
  }

  getLastStats(): OutputStats {
    return this.stats;
  }

  getLatencySec(): number {
    const baseLatency = Number.isFinite(this.context.baseLatency) ? this.context.baseLatency : 0;
    return baseLatency + 128 / SAMPLE_RATE + SOUND_TOUCH_PIPELINE_LATENCY_SEC;
  }

  async destroy(): Promise<void> {
    this.sourceNode.port.postMessage({ type: "reset" });
    this.sourceNode.disconnect();
    this.soundTouchNode.disconnect();
    await this.context.close().catch(() => {});
  }
}

class ScriptProcessorPcmOutput implements PcmOutput {
  private context: AudioContext;
  private node: ScriptProcessorNode;
  private queue: Array<{ samples: Float32Array; offset: number }> = [];
  private playbackRate = 1;
  private paused = false;
  private sourceCursor = 0;
  private stats: OutputStats = {
    playedSourceFrames: 0,
    bufferedSourceFrames: 0,
  };
  private processCount = 0;
  private onStats: (stats: OutputStats) => void;

  private constructor(context: AudioContext, node: ScriptProcessorNode, onStats: (stats: OutputStats) => void) {
    this.context = context;
    this.node = node;
    this.onStats = onStats;
  }

  static async create(onStats: (stats: OutputStats) => void): Promise<ScriptProcessorPcmOutput> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const node = context.createScriptProcessor(2048, 0, 1);
    const output = new ScriptProcessorPcmOutput(context, node, onStats);
    node.onaudioprocess = (event) => output.process(event.outputBuffer.getChannelData(0));
    node.connect(context.destination);
    await context.resume();
    return output;
  }

  appendPcm(samples: Int16Array): void {
    const floatSamples = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      floatSamples[index] = samples[index] / 32768;
    }
    this.queue.push({ samples: floatSamples, offset: 0 });
    this.stats.bufferedSourceFrames += floatSamples.length;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
  }

  getLastStats(): OutputStats {
    return this.stats;
  }

  getLatencySec(): number {
    const baseLatency = Number.isFinite(this.context.baseLatency) ? this.context.baseLatency : 0;
    return baseLatency + this.node.bufferSize / SAMPLE_RATE;
  }

  private process(output: Float32Array): void {
    output.fill(0);
    if (!this.paused) {
      for (let index = 0; index < output.length; index += 1) {
        output[index] = this.readSample();
      }
    }

    this.processCount += 1;
    if (this.processCount % 8 === 0) {
      this.onStats(this.stats);
    }
  }

  private compactQueue(): void {
    while (this.queue.length > 0) {
      const chunk = this.queue[0];
      const remaining = chunk.samples.length - chunk.offset;
      if (remaining <= 0) {
        this.queue.shift();
        continue;
      }

      if (this.sourceCursor < remaining) {
        return;
      }

      this.sourceCursor -= remaining;
      chunk.offset = chunk.samples.length;
      this.queue.shift();
    }
  }

  private sampleAt(position: number): number | null {
    let remaining = position;
    for (let chunkIndex = 0; chunkIndex < this.queue.length; chunkIndex += 1) {
      const chunk = this.queue[chunkIndex];
      const chunkRemaining = chunk.samples.length - chunk.offset;
      if (chunkRemaining <= 0) continue;

      if (remaining < chunkRemaining) {
        const absolute = chunk.offset + remaining;
        const baseIndex = Math.floor(absolute);
        const frac = absolute - baseIndex;
        const current = chunk.samples[baseIndex] ?? 0;

        if (frac <= 0) {
          return current;
        }

        if (baseIndex + 1 < chunk.samples.length) {
          const next = chunk.samples[baseIndex + 1];
          return current + (next - current) * frac;
        }

        for (let nextChunkIndex = chunkIndex + 1; nextChunkIndex < this.queue.length; nextChunkIndex += 1) {
          const nextChunk = this.queue[nextChunkIndex];
          const nextBase = nextChunk.samples[nextChunk.offset];
          if (typeof nextBase === "number") {
            return current + (nextBase - current) * frac;
          }
        }

        return current;
      }

      remaining -= chunkRemaining;
    }

    return null;
  }

  private readSample(): number {
    this.compactQueue();
    const sample = this.sampleAt(this.sourceCursor);
    if (sample === null) {
      return 0;
    }

    this.sourceCursor += this.playbackRate;
    this.stats.playedSourceFrames += this.playbackRate;
    this.stats.bufferedSourceFrames = Math.max(0, this.stats.bufferedSourceFrames - this.playbackRate);
    this.compactQueue();
    return sample;
  }

  async destroy(): Promise<void> {
    this.queue = [];
    this.sourceCursor = 0;
    this.node.disconnect();
    await this.context.close().catch(() => {});
  }
}

class PlaybackSession {
  private params: StartStreamMessage;
  private tabId?: number;
  private state: StreamSessionState = "idle";
  private socket: WebSocket | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioBlobUrl: string | null = null;
  private cachedAudioContext: AudioContext | null = null;
  private cachedMediaSource: MediaElementAudioSourceNode | null = null;
  private cachedSoundTouchNode: SoundTouchNode | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private keepAliveId: ReturnType<typeof setInterval> | null = null;
  private finishDelayId: ReturnType<typeof setTimeout> | null = null;
  private output: PcmOutput | null = null;
  private groups: StreamGroup[] = [];
  private highlightSlices: Array<Array<{ startChar: number; endChar: number }>> = [];
  private ledger: TranscriptLedgerEntry[] = [];
  private groupDurationsSec: number[] = [];
  private nextGroupToSend = 0;
  private receivingGroupIndex: number | null = null;
  private allGroupsFlushed = false;
  private lastTranscriptKey = "";
  private currentSec = 0;
  private totalSec = 0;
  private baseOffsetSec = 0;
  private livePcmChunks: Int16Array[] = [];
  private cacheAllowed = true;
  private readonly transcriptLagWallSec = 0.025;

  constructor(params: StartStreamMessage, tabId?: number) {
    this.params = params;
    this.tabId = tabId;
    this.groups = buildStreamGroups(params.text);
    this.highlightSlices = this.groups.map((group) => buildGroupHighlightSlices(group));
    this.groupDurationsSec = new Array(this.groups.length).fill(0);
    this.ledger = this.groups.map((group, index) => ({
      groupId: index,
      startChar: group.startChar,
      endChar: group.endChar,
      sampleCount: 0,
      durationSec: 0,
    }));
    this.totalSec = getDurationEstimate(this.groups, this.groupDurationsSec);
  }

  get sessionId(): string {
    return this.params.sessionId;
  }

  getState(): StreamSessionState {
    return this.state;
  }

  matchesTab(tabId: number): boolean {
    return typeof this.tabId === "number" && this.tabId === tabId;
  }

  async start(): Promise<void> {
    if (!this.groups.length) {
      throw new Error("No text to read");
    }

    if (this.params.playbackEngine === "stable") {
      const cached = await getCachedAudio(buildCacheKey(this.params));
      if (cached) {
        this.groupDurationsSec =
          cached.entry.chunkDurations.length === this.groups.length
            ? [...cached.entry.chunkDurations]
            : this.groupDurationsSec;
        await this.startCachedPlayback(cached.audioData, cached.entry.durationSec);
        return;
      }
    }

    await this.startLivePlaybackFromGroup(0, 0);
  }

  async pause(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      this.setState("paused", "Playback paused.");
      return;
    }

    if (this.output) {
      this.output.setPaused(true);
      this.startKeepAlive();
      this.setState("paused", "Playback paused.");
    }
  }

  async resume(): Promise<void> {
    if (this.audio) {
      await this.audio.play();
      this.setState("playing");
      return;
    }

    this.stopKeepAlive();

    if (this.output) {
      this.output.setPaused(false);
      this.setState("playing");
      return;
    }

    const target = resolveGroupTarget(this.groups, this.groupDurationsSec, this.currentSec);
    await this.startLivePlaybackFromGroup(target.index, target.startSec);
  }

  async seek(positionSec: number): Promise<number> {
    if (this.audio) {
      this.audio.currentTime = positionSec;
      this.currentSec = positionSec;
      this.emitProgress();
      return positionSec;
    }

    this.cacheAllowed = false;
    const target = resolveGroupTarget(this.groups, this.groupDurationsSec, positionSec);
    await this.startLivePlaybackFromGroup(target.index, target.startSec);
    this.currentSec = target.startSec;
    this.emitProgress();
    return target.startSec;
  }

  setSpeed(speed: number): void {
    this.params.speed = speed;
    if (this.audio) {
      this.audio.playbackRate = speed;
      this.audio.preservesPitch = !this.cachedSoundTouchNode;
      if (this.cachedSoundTouchNode) {
        this.cachedSoundTouchNode.playbackRate.value = speed;
        this.cachedSoundTouchNode.pitch.value = 1;
      }
    }
    if (this.output) {
      this.output.setPlaybackRate(speed);
    }
    this.emitProgress();
  }

  async stop(): Promise<void> {
    this.setState("stopping");
    this.clearTimer();
    this.stopKeepAlive();
    this.clearFinishDelay();

    if (this.socket) {
      try {
        this.socket.send(JSON.stringify({ type: "Clear" }));
        this.socket.send(JSON.stringify({ type: "Close" }));
      } catch {
        // ignore close race
      }
      this.socket.close();
      this.socket = null;
    }

    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }

    if (this.audioBlobUrl) {
      URL.revokeObjectURL(this.audioBlobUrl);
      this.audioBlobUrl = null;
    }

    if (this.output) {
      await this.output.destroy();
      this.output = null;
    }

    this.currentSec = 0;
    this.totalSec = 0;
    this.setState("idle");
  }

  private async startCachedPlayback(audioData: ArrayBuffer, durationSec: number): Promise<void> {
    this.clearTimer();
    this.stopKeepAlive();
    this.clearFinishDelay();
    this.baseOffsetSec = 0;
    this.currentSec = 0;
    this.totalSec = durationSec;
    this.lastTranscriptKey = "";
    this.audioBlobUrl = URL.createObjectURL(new Blob([audioData], { type: "audio/wav" }));
    this.audio = new Audio(this.audioBlobUrl);
    await this.attachCachedAudioGraph();
    this.audio.preservesPitch = !this.cachedSoundTouchNode;
    this.audio.playbackRate = this.params.speed;
    if (this.cachedSoundTouchNode) {
      this.cachedSoundTouchNode.playbackRate.value = this.params.speed;
      this.cachedSoundTouchNode.pitch.value = 1;
    }

    this.audio.onplay = () => {
      this.setState("playing");
      this.startTimer();
    };
    this.audio.onpause = () => {
      if (this.state !== "idle") {
        this.setState("paused");
      }
      this.clearTimer();
    };
    this.audio.onended = () => {
      this.clearTimer();
      sendEvent(this.sessionId, this.tabId, { event: "ended" });
      void this.teardownPlaybackArtifacts().then(() => {
        this.setState("idle");
      });
    };
    this.audio.onerror = () => {
      this.handleFatalError("Cached audio playback failed");
    };

    await this.audio.play();
  }

  private async startLivePlaybackFromGroup(groupIndex: number, baseOffsetSec: number): Promise<void> {
    this.clearTimer();
    this.stopKeepAlive();
    this.clearFinishDelay();

    if (this.socket) {
      try {
        this.socket.send(JSON.stringify({ type: "Clear" }));
        this.socket.send(JSON.stringify({ type: "Close" }));
      } catch {
        // ignore
      }
      this.socket.close();
      this.socket = null;
    }

    if (this.output) {
      await this.output.destroy();
      this.output = null;
    }

    this.audio = null;
    this.baseOffsetSec = baseOffsetSec;
    this.nextGroupToSend = groupIndex;
    this.receivingGroupIndex = null;
    this.allGroupsFlushed = false;
    this.currentSec = baseOffsetSec;
    this.totalSec = getDurationEstimate(this.groups, this.groupDurationsSec);
    this.lastTranscriptKey = "";
    if (groupIndex > 0) {
      this.setTranscriptForCurrentTime();
    }

    this.output = await this.createOutput();
    this.output.setPlaybackRate(this.params.speed);
    this.output.setPaused(false);

    this.setState("connecting", "Connecting to speech stream...");
    await this.connectSocket();
    this.sendNextGroup(true);
  }

  private async createOutput(): Promise<PcmOutput> {
    try {
      return await WorkletPcmOutput.create((stats) => this.handleOutputStats(stats));
    } catch (error) {
      console.warn("[Offscreen] Falling back to ScriptProcessorNode:", error);
      return ScriptProcessorPcmOutput.create((stats) => this.handleOutputStats(stats));
    }
  }

  private async connectSocket(): Promise<void> {
    const params = new URLSearchParams({
      model: this.params.voice,
      encoding: "linear16",
      sample_rate: String(SAMPLE_RATE),
    });
    const socket = new WebSocket(`wss://api.deepgram.com/v1/speak?${params.toString()}`, [
      "token",
      this.params.apiKey,
    ]);
    socket.binaryType = "arraybuffer";

    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        this.setState("buffering", "Buffering playback...");
        resolve();
      };
      socket.onerror = () => reject(new Error("Deepgram stream connection failed"));
      socket.onclose = () => {
        this.socket = null;
      };
      socket.onmessage = (event) => {
        void this.handleSocketMessage(event.data);
      };
    });
  }

  private async handleSocketMessage(data: Blob | ArrayBuffer | string): Promise<void> {
    if (typeof data === "string") {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(message.type || "");
      if (type === "Flushed") {
        const groupIndex = this.receivingGroupIndex;
        if (typeof groupIndex === "number") {
          const sampleCount = this.ledger[groupIndex].sampleCount;
          this.groupDurationsSec[groupIndex] = sampleCount / SAMPLE_RATE;
          this.ledger[groupIndex].durationSec = this.groupDurationsSec[groupIndex];
          this.receivingGroupIndex = null;
        }

        if (this.nextGroupToSend >= this.groups.length) {
          this.allGroupsFlushed = true;
          if (this.socket) {
            try {
              this.socket.send(JSON.stringify({ type: "Close" }));
            } catch {
              // ignore close race
            }
          }
        } else {
          this.sendNextGroup();
        }
        return;
      }

      if (type === "Warning") {
        sendEvent(this.sessionId, this.tabId, {
          event: "warning",
          warning: String(message.description || "Playback warning"),
        });
        return;
      }

      if (type === "Error" || type === "Unhandled") {
        this.handleFatalError(String(message.description || message.error || "Playback error"));
      }
      return;
    }

    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const pcm = toInt16Array(buffer);
    this.output?.appendPcm(pcm);

    if (this.receivingGroupIndex !== null) {
      this.ledger[this.receivingGroupIndex].sampleCount += pcm.length / CHANNELS;
    }

    if (this.cacheAllowed) {
      this.livePcmChunks.push(pcm);
    }

    if (this.state === "buffering") {
      this.setState("playing");
    }
  }

  private handleOutputStats(stats: OutputStats): void {
    const sourceProgressSec = stats.playedSourceFrames / SAMPLE_RATE;
    const audibleLagSec =
      ((this.output?.getLatencySec() ?? 0) + this.transcriptLagWallSec) * this.params.speed;
    this.currentSec = Math.max(this.baseOffsetSec, this.baseOffsetSec + sourceProgressSec - audibleLagSec);
    this.totalSec = getDurationEstimate(this.groups, this.groupDurationsSec);
    this.emitProgress();

    if (
      this.socket &&
      this.receivingGroupIndex === null &&
      this.nextGroupToSend < this.groups.length &&
      this.getBufferedWallSeconds(stats) < LOW_BUFFER_SECONDS
    ) {
      this.sendNextGroup();
    }

    if (this.allGroupsFlushed && stats.bufferedSourceFrames <= 0) {
      this.scheduleFinishLivePlayback();
    } else {
      this.clearFinishDelay();
    }
  }

  private async finishLivePlayback(): Promise<void> {
    this.clearFinishDelay();
    if (this.cacheAllowed && this.livePcmChunks.length > 0) {
      try {
        const mergedSamples = concatInt16Arrays(this.livePcmChunks);
        const wav = encodePcm16ToWav(mergedSamples, SAMPLE_RATE, CHANNELS);
        await putCachedAudio({
          key: buildCacheKey(this.params),
          audioData: wav,
          durationSec: mergedSamples.length / SAMPLE_RATE,
          chunkDurations: [...this.groupDurationsSec],
          budgetMb: this.params.cacheBudgetMb,
        });
      } catch (error) {
        console.warn("[Offscreen] Failed to cache streamed audio:", error);
      }
    }

    sendEvent(this.sessionId, this.tabId, { event: "ended" });
    await this.teardownPlaybackArtifacts();
    this.setState("idle");
  }

  private sendNextGroup(force = false): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.receivingGroupIndex !== null) return;
    if (this.nextGroupToSend >= this.groups.length) return;
    if (!force && this.output && this.getBufferedWallSeconds(this.output.getLastStats()) >= LOW_BUFFER_SECONDS) {
      return;
    }

    const group = this.groups[this.nextGroupToSend];
    this.receivingGroupIndex = group.index;
    this.socket.send(JSON.stringify({ type: "Speak", text: group.text }));
    this.socket.send(JSON.stringify({ type: "Flush" }));
    this.nextGroupToSend += 1;
  }

  private getBufferedWallSeconds(stats: OutputStats): number {
    const speed = Math.max(0.5, this.params.speed || 1);
    return stats.bufferedSourceFrames / SAMPLE_RATE / speed;
  }

  private emitProgress(): void {
    sendEvent(this.sessionId, this.tabId, {
      event: "timeupdate",
      currentSec: this.currentSec,
      durationSec: this.totalSec,
    });
    this.setTranscriptForCurrentTime();
  }

  private setTranscriptForCurrentTime(): void {
    const range = resolveTranscriptRange(
      this.groups,
      this.highlightSlices,
      this.groupDurationsSec,
      this.currentSec
    );

    if (!range) return;
    const key = `${range.index}:${range.startChar}:${range.endChar}`;
    if (key === this.lastTranscriptKey) return;
    this.lastTranscriptKey = key;

    sendEvent(this.sessionId, this.tabId, {
      event: "transcriptRange",
      startChar: range.startChar,
      endChar: range.endChar,
    });
  }

  private startTimer(): void {
    this.clearTimer();
    this.timerId = setInterval(() => {
      if (!this.audio) return;
      const latencySec = this.getCachedPlaybackLatencySec();
      const currentTime = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
      this.currentSec = Math.max(0, currentTime - latencySec * this.params.speed);
      this.totalSec =
        Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.totalSec;
      this.emitProgress();
    }, 120);
  }

  private async attachCachedAudioGraph(): Promise<void> {
    if (!this.audio) return;
    if (this.cachedAudioContext && this.cachedMediaSource && this.cachedSoundTouchNode) {
      return;
    }

    try {
      const context = new AudioContext();
      await SoundTouchNode.register(context, soundTouchProcessorUrl);
      const mediaSource = context.createMediaElementSource(this.audio);
      const soundTouchNode = new SoundTouchNode(context);
      mediaSource.connect(soundTouchNode);
      soundTouchNode.connect(context.destination);
      await context.resume();
      this.cachedAudioContext = context;
      this.cachedMediaSource = mediaSource;
      this.cachedSoundTouchNode = soundTouchNode;
    } catch (error) {
      console.warn("[Offscreen] Failed to attach cached pitch-preserving audio graph:", error);
      await this.destroyCachedAudioGraph();
    }
  }

  private getCachedPlaybackLatencySec(): number {
    if (!this.cachedAudioContext) return 0;
    const baseLatency = Number.isFinite(this.cachedAudioContext.baseLatency)
      ? this.cachedAudioContext.baseLatency
      : 0;
    return baseLatency + SOUND_TOUCH_PIPELINE_LATENCY_SEC;
  }

  private clearTimer(): void {
    if (!this.timerId) return;
    clearInterval(this.timerId);
    this.timerId = null;
  }

  private scheduleFinishLivePlayback(): void {
    if (this.finishDelayId) return;

    const delayMs = Math.max(120, Math.ceil(((this.output?.getLatencySec() ?? 0.1) + 0.04) * 1000));
    this.finishDelayId = setTimeout(() => {
      this.finishDelayId = null;
      void this.finishLivePlayback();
    }, delayMs);
  }

  private clearFinishDelay(): void {
    if (!this.finishDelayId) return;
    clearTimeout(this.finishDelayId);
    this.finishDelayId = null;
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.keepAliveId = setInterval(() => {
      try {
        this.socket?.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {
        this.stopKeepAlive();
      }
    }, KEEP_ALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (!this.keepAliveId) return;
    clearInterval(this.keepAliveId);
    this.keepAliveId = null;
  }

  private setState(state: StreamSessionState, detail?: string): void {
    this.state = state;
    sendEvent(this.sessionId, this.tabId, {
      event: "state",
      state,
      detail,
    });
  }

  private handleFatalError(message: string): void {
    this.setState("error", message);
    sendEvent(this.sessionId, this.tabId, {
      event: "error",
      error: message,
    });
    void this.teardownPlaybackArtifacts();
  }

  private async teardownPlaybackArtifacts(): Promise<void> {
    this.clearTimer();
    this.stopKeepAlive();
    this.clearFinishDelay();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }

    if (this.audioBlobUrl) {
      URL.revokeObjectURL(this.audioBlobUrl);
      this.audioBlobUrl = null;
    }

    await this.destroyCachedAudioGraph();

    if (this.output) {
      await this.output.destroy();
      this.output = null;
    }
  }

  private async destroyCachedAudioGraph(): Promise<void> {
    if (this.cachedSoundTouchNode) {
      this.cachedSoundTouchNode.disconnect();
      this.cachedSoundTouchNode = null;
    }

    if (this.cachedMediaSource) {
      this.cachedMediaSource.disconnect();
      this.cachedMediaSource = null;
    }

    if (this.cachedAudioContext) {
      await this.cachedAudioContext.close().catch(() => {});
      this.cachedAudioContext = null;
    }
  }
}

let activeSession: PlaybackSession | null = null;

async function ensureSessionStopped(): Promise<void> {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;
  await session.stop();
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  const command = message as OffscreenControlMessage & { target: "offscreen"; tabId?: number };

  const resolve = (response: OffscreenResponse) => sendResponse(response);
  const reject = (error: unknown) => resolve({ success: false, error: describeStreamError(error) });

  switch (command.action) {
    case "startStream":
      void (async () => {
        try {
          await ensureSessionStopped();
          activeSession = new PlaybackSession(command, command.tabId);
          await activeSession.start();
          resolve({ success: true });
        } catch (error) {
          activeSession = null;
          reject(error);
        }
      })();
      return true;

    case "pauseStream":
      void (async () => {
        try {
          if (activeSession && activeSession.sessionId === command.sessionId) {
            await activeSession.pause();
            resolve({ success: true });
            return;
          }
          resolve({ success: false, error: "Session not found" });
        } catch (error) {
          reject(error);
        }
      })();
      return true;

    case "resumeStream":
      void (async () => {
        try {
          if (activeSession && activeSession.sessionId === command.sessionId) {
            await activeSession.resume();
            resolve({ success: true });
            return;
          }
          resolve({ success: false, error: "Session not found" });
        } catch (error) {
          reject(error);
        }
      })();
      return true;

    case "seekStream":
      void (async () => {
        try {
          if (activeSession && activeSession.sessionId === command.sessionId) {
            const snappedToSec = await activeSession.seek(command.positionSec);
            resolve({ success: true, snappedToSec });
            return;
          }
          resolve({ success: false, error: "Session not found", snappedToSec: command.positionSec });
        } catch (error) {
          reject(error);
        }
      })();
      return true;

    case "setStreamSpeed":
      if (activeSession && activeSession.sessionId === command.sessionId) {
        activeSession.setSpeed(command.speed);
        resolve({ success: true });
        return;
      }
      resolve({ success: false, error: "Session not found" });
      return;

    case "getSessionState":
      if (activeSession && activeSession.sessionId === command.sessionId) {
        resolve({ success: true, state: activeSession.getState() });
        return;
      }
      resolve({ success: false, error: "Session not found", state: "idle" });
      return;

    case "stopStream":
      void (async () => {
        try {
          if (!command.sessionId || (activeSession && activeSession.sessionId === command.sessionId)) {
            await ensureSessionStopped();
          }
          resolve({ success: true });
        } catch (error) {
          reject(error);
        }
      })();
      return true;

    case "stopForTab":
      void (async () => {
        try {
          if (activeSession && activeSession.matchesTab(command.tabId)) {
            await ensureSessionStopped();
          }
          resolve({ success: true });
        } catch (error) {
          reject(error);
        }
      })();
      return true;
  }
});
