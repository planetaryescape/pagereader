import { WaveFile } from "wavefile";

interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitDepth: string;
  samples: Int16Array;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseWav(buffer: ArrayBuffer): ParsedWav {
  const wav = new WaveFile(new Uint8Array(buffer));
  const fmt = wav.fmt as { sampleRate?: number; numChannels?: number };
  const sampleRate = Number(fmt.sampleRate);
  const channels = Number(fmt.numChannels);

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Invalid WAV sample rate");
  }

  if (!Number.isFinite(channels) || channels <= 0) {
    throw new Error("Invalid WAV channels");
  }

  wav.toBitDepth("16");
  const samples = Int16Array.from(wav.getSamples(true) as ArrayLike<number>);

  return {
    sampleRate,
    channels,
    bitDepth: "16",
    samples,
  };
}

export function getWavDurationSeconds(buffer: ArrayBuffer): number {
  const parsed = parseWav(buffer);
  return parsed.samples.length / (parsed.sampleRate * parsed.channels);
}

export function mergeWavChunks(buffers: ArrayBuffer[]): ArrayBuffer {
  if (!buffers.length) {
    throw new Error("No WAV chunks to merge");
  }

  const parsed = buffers.map(parseWav);
  const first = parsed[0];

  for (const item of parsed) {
    if (item.sampleRate !== first.sampleRate) {
      throw new Error("WAV sample rate mismatch");
    }
    if (item.channels !== first.channels) {
      throw new Error("WAV channel mismatch");
    }
    if (item.bitDepth !== first.bitDepth) {
      throw new Error("WAV bit depth mismatch");
    }
  }

  const totalSamples = parsed.reduce((sum, item) => sum + item.samples.length, 0);
  const mergedSamples = new Int16Array(totalSamples);

  let offset = 0;
  for (const item of parsed) {
    mergedSamples.set(item.samples, offset);
    offset += item.samples.length;
  }

  const output = new WaveFile();
  output.fromScratch(first.channels, first.sampleRate, "16", mergedSamples);

  return bytesToArrayBuffer(output.toBuffer());
}

export function encodePcm16ToWav(
  samples: Int16Array,
  sampleRate: number,
  channels = 1
): ArrayBuffer {
  const output = new WaveFile();
  output.fromScratch(channels, sampleRate, "16", samples);
  return bytesToArrayBuffer(output.toBuffer());
}
