class PcmStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.playedSourceFrames = 0;
    this.bufferedSourceFrames = 0;
    this.sourceCursor = 0;
    this.playbackRate = 1;
    this.paused = false;
    this.processCount = 0;

    this.port.onmessage = (event) => {
      const data = event.data || {};
      switch (data.type) {
        case "append":
          if (data.samples) {
            const samples = new Float32Array(data.samples);
            this.queue.push({ samples, offset: 0 });
            this.bufferedSourceFrames += samples.length;
          }
          break;
        case "setPlaybackRate":
          this.playbackRate = Math.max(0.5, Math.min(2, Number(data.playbackRate || 1)));
          break;
        case "setPaused":
          this.paused = !!data.paused;
          break;
        case "reset":
          this.queue = [];
          this.playedSourceFrames = 0;
          this.bufferedSourceFrames = 0;
          this.sourceCursor = 0;
          this.paused = false;
          break;
      }
    };
  }

  compactQueue() {
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

  sampleAt(position) {
    let remaining = position;
    for (let chunkIndex = 0; chunkIndex < this.queue.length; chunkIndex += 1) {
      const chunk = this.queue[chunkIndex];
      const chunkRemaining = chunk.samples.length - chunk.offset;
      if (chunkRemaining <= 0) {
        continue;
      }

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

  readSample() {
    this.compactQueue();
    const sample = this.sampleAt(this.sourceCursor);
    if (sample === null) {
      return 0;
    }

    this.sourceCursor += this.playbackRate;
    this.playedSourceFrames += this.playbackRate;
    this.bufferedSourceFrames = Math.max(0, this.bufferedSourceFrames - this.playbackRate);
    this.compactQueue();
    return sample;
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }

    output.fill(0);
    if (!this.paused) {
      for (let index = 0; index < output.length; index += 1) {
        output[index] = this.readSample();
      }
    }

    this.processCount += 1;
    if (this.processCount % 8 === 0) {
      this.port.postMessage({
        type: "stats",
        playedSourceFrames: this.playedSourceFrames,
        bufferedSourceFrames: this.bufferedSourceFrames,
      });
    }

    return true;
  }
}

registerProcessor("pcm-stream-processor", PcmStreamProcessor);
