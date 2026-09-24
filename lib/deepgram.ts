import sbd from "sbd";

const DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";
export const DEEPGRAM_MODEL_VERSION = "deepgram-aura-v1";
const RETRY_DELAYS_MS = [400, 900, 1800];

export interface DeepgramOptions {
  apiKey: string;
  voice: string;
  speed?: number;
}

export interface ChunkUnit {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
  paragraphIndex: number;
}

export interface DeepgramRequestError extends Error {
  status?: number;
  retryable: boolean;
}

class DeepgramRequestErrorImpl extends Error implements DeepgramRequestError {
  status?: number;
  retryable: boolean;

  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "DeepgramRequestError";
    this.retryable = retryable;
    this.status = status;
  }
}

const DEFAULT_MAX_CHARS = 900;
const MAX_SENTENCE_OVERFLOW_CHARS = 650;

interface TextSlice {
  start: number;
  end: number;
  paragraphIndex: number;
}

interface SentenceSlice {
  start: number;
  end: number;
}

function randomJitter(max = 150): number {
  return Math.floor(Math.random() * max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status?: number): boolean {
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || status >= 500;
}

function toDeepgramError(error: unknown, status?: number): DeepgramRequestError {
  if (error && typeof error === "object" && "retryable" in error && "message" in error) {
    return error as DeepgramRequestError;
  }
  const retryable = isRetryableStatus(status);
  const message = error instanceof Error ? error.message : "DeepGram request failed";
  return new DeepgramRequestErrorImpl(message, retryable, status);
}

function getTrimmedRange(text: string, start: number, end: number): SentenceSlice | null {
  let left = start;
  let right = end;

  while (left < right && /\s/.test(text[left])) left += 1;
  while (right > left && /\s/.test(text[right - 1])) right -= 1;

  if (right <= left) {
    return null;
  }

  return { start: left, end: right };
}

function splitParagraphs(text: string): TextSlice[] {
  const paragraphs: TextSlice[] = [];
  const boundaryRegex = /(?:\r?\n\s*){2,}/g;
  let paragraphStart = 0;
  let paragraphIndex = 0;

  for (const match of text.matchAll(boundaryRegex)) {
    const boundaryStart = match.index ?? 0;
    const trimmed = getTrimmedRange(text, paragraphStart, boundaryStart);
    if (trimmed) {
      paragraphs.push({
        start: trimmed.start,
        end: trimmed.end,
        paragraphIndex,
      });
      paragraphIndex += 1;
    }
    paragraphStart = boundaryStart + match[0].length;
  }

  const tail = getTrimmedRange(text, paragraphStart, text.length);
  if (tail) {
    paragraphs.push({
      start: tail.start,
      end: tail.end,
      paragraphIndex,
    });
  }

  if (!paragraphs.length && text.trim()) {
    return [
      {
        start: 0,
        end: text.length,
        paragraphIndex: 0,
      },
    ];
  }

  return paragraphs;
}

function splitLongSlice(text: string, start: number, end: number, maxChars: number): SentenceSlice[] {
  const slices: SentenceSlice[] = [];
  const chunkText = text.slice(start, end);
  const tokenRegex = /\S+/g;
  const tokens = Array.from(chunkText.matchAll(tokenRegex), (match) => ({
    start: start + (match.index ?? 0),
    end: start + (match.index ?? 0) + match[0].length,
  }));

  if (!tokens.length) return [];

  let currentStart = tokens[0].start;
  let currentEnd = tokens[0].end;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.end - currentStart <= maxChars) {
      currentEnd = token.end;
      continue;
    }

    if (currentEnd > currentStart) {
      slices.push({ start: currentStart, end: currentEnd });
    }

    if (token.end - token.start > maxChars) {
      for (let pos = token.start; pos < token.end; pos += maxChars) {
        slices.push({ start: pos, end: Math.min(pos + maxChars, token.end) });
      }
      const last = slices[slices.length - 1];
      currentStart = last.end;
      currentEnd = last.end;
      continue;
    }

    currentStart = token.start;
    currentEnd = token.end;
  }

  if (currentEnd > currentStart) {
    slices.push({ start: currentStart, end: currentEnd });
  }

  return slices;
}

function splitParagraphToSlices(text: string, paragraph: TextSlice, maxChars: number): SentenceSlice[] {
  const paragraphText = text.slice(paragraph.start, paragraph.end);
  const sentenceTexts = sbd.sentences(paragraphText);
  const sentenceSlices: SentenceSlice[] = [];

  if (!sentenceTexts.length) {
    return splitLongSlice(text, paragraph.start, paragraph.end, maxChars);
  }

  let cursor = 0;
  for (const rawSentence of sentenceTexts) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    let localStart = paragraphText.indexOf(sentence, cursor);
    if (localStart === -1) {
      localStart = paragraphText.indexOf(sentence);
    }
    if (localStart === -1) {
      localStart = cursor;
    }

    const absoluteStart = paragraph.start + localStart;
    const absoluteEnd = Math.min(paragraph.end, absoluteStart + sentence.length);
    cursor = Math.max(cursor, localStart + sentence.length);

    const sentenceLength = absoluteEnd - absoluteStart;
    if (sentenceLength > maxChars && sentenceLength > MAX_SENTENCE_OVERFLOW_CHARS) {
      sentenceSlices.push(...splitLongSlice(text, absoluteStart, absoluteEnd, maxChars));
    } else if (absoluteEnd > absoluteStart) {
      sentenceSlices.push({ start: absoluteStart, end: absoluteEnd });
    }
  }

  if (!sentenceSlices.length) {
    return splitLongSlice(text, paragraph.start, paragraph.end, maxChars);
  }

  return sentenceSlices;
}

export function chunkTextWithBoundaries(text: string, maxChars = DEFAULT_MAX_CHARS): ChunkUnit[] {
  const normalizedText = text.trim();
  if (!normalizedText) return [];

  const chunks: ChunkUnit[] = [];
  const paragraphs = splitParagraphs(normalizedText);

  for (const paragraph of paragraphs) {
    const sentenceSlices = splitParagraphToSlices(normalizedText, paragraph, maxChars);
    let currentStart: number | null = null;
    let currentEnd: number | null = null;

    for (const slice of sentenceSlices) {
      if (currentStart === null || currentEnd === null) {
        currentStart = slice.start;
        currentEnd = slice.end;
        continue;
      }

      const mergedText = normalizedText.slice(currentStart, slice.end).trim();
      if (mergedText.length <= maxChars) {
        currentEnd = slice.end;
      } else {
        const chunkText = normalizedText.slice(currentStart, currentEnd).trim();
        if (chunkText) {
          chunks.push({
            index: chunks.length,
            text: chunkText,
            startChar: currentStart,
            endChar: currentEnd,
            paragraphIndex: paragraph.paragraphIndex,
          });
        }
        currentStart = slice.start;
        currentEnd = slice.end;
      }
    }

    if (currentStart !== null && currentEnd !== null) {
      const chunkText = normalizedText.slice(currentStart, currentEnd).trim();
      if (chunkText) {
        chunks.push({
          index: chunks.length,
          text: chunkText,
          startChar: currentStart,
          endChar: currentEnd,
          paragraphIndex: paragraph.paragraphIndex,
        });
      }
    }
  }

  return chunks;
}

async function synthesizeSpeechRequest(
  text: string,
  options: DeepgramOptions
): Promise<ArrayBuffer> {
  const { apiKey, voice } = options;
  const params = new URLSearchParams({
    model: voice,
    encoding: "linear16",
    container: "wav",
    sample_rate: "24000",
  });
  const url = `${DEEPGRAM_TTS_URL}?${params}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "text/plain",
    },
    body: text,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new DeepgramRequestErrorImpl(
      `DeepGram TTS error: ${response.status} - ${errorText}`,
      isRetryableStatus(response.status),
      response.status
    );
  }

  return response.arrayBuffer();
}

export async function synthesizeSpeech(
  text: string,
  options: DeepgramOptions
): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await synthesizeSpeechRequest(text, options);
    } catch (error) {
      const deepgramError = toDeepgramError(error);
      const canRetry = deepgramError.retryable && attempt < RETRY_DELAYS_MS.length;
      if (!canRetry) {
        throw deepgramError;
      }

      const delayMs = RETRY_DELAYS_MS[attempt] + randomJitter();
      await sleep(delayMs);
    }
  }
  throw new DeepgramRequestErrorImpl("DeepGram request failed after retries", true);
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await synthesizeSpeech("Test", { apiKey, voice: "aura-2-thalia-en" });
    return true;
  } catch {
    return false;
  }
}

// Voice list from DeepGram Aura
export const VOICES = [
  // Aura 1
  { id: "aura-asteria-en", name: "Asteria (Female, US)", tier: "aura" },
  { id: "aura-luna-en", name: "Luna (Female, US)", tier: "aura" },
  { id: "aura-stella-en", name: "Stella (Female, US)", tier: "aura" },
  { id: "aura-athena-en", name: "Athena (Female, UK)", tier: "aura" },
  { id: "aura-hera-en", name: "Hera (Female, US)", tier: "aura" },
  { id: "aura-orion-en", name: "Orion (Male, US)", tier: "aura" },
  { id: "aura-arcas-en", name: "Arcas (Male, US)", tier: "aura" },
  { id: "aura-perseus-en", name: "Perseus (Male, US)", tier: "aura" },
  { id: "aura-angus-en", name: "Angus (Male, Ireland)", tier: "aura" },
  { id: "aura-orpheus-en", name: "Orpheus (Male, US)", tier: "aura" },
  { id: "aura-helios-en", name: "Helios (Male, UK)", tier: "aura" },
  { id: "aura-zeus-en", name: "Zeus (Male, US)", tier: "aura" },
  // Aura 2
  { id: "aura-2-andromeda-en", name: "Andromeda (Female, US)", tier: "aura-2" },
  { id: "aura-2-aurora-en", name: "Aurora (Female, US)", tier: "aura-2" },
  { id: "aura-2-callista-en", name: "Callista (Female, US)", tier: "aura-2" },
  { id: "aura-2-draco-en", name: "Draco (Male, US)", tier: "aura-2" },
  { id: "aura-2-delia-en", name: "Delia (Female, UK)", tier: "aura-2" },
  { id: "aura-2-arcas-en", name: "Arcas 2 (Male, US)", tier: "aura-2" },
  { id: "aura-2-leo-en", name: "Leo (Male, US)", tier: "aura-2" },
  { id: "aura-2-luna-en", name: "Luna 2 (Female, US)", tier: "aura-2" },
  { id: "aura-2-orion-en", name: "Orion 2 (Male, US)", tier: "aura-2" },
  { id: "aura-2-phoebe-en", name: "Phoebe (Female, UK)", tier: "aura-2" },
  { id: "aura-2-stella-en", name: "Stella 2 (Female, US)", tier: "aura-2" },
  { id: "aura-2-thalia-en", name: "Thalia (Female, US)", tier: "aura-2" },
];
