import { chunkTextWithBoundaries } from "./deepgram";
import type { StreamGroup } from "./playback-messages";

interface HighlightSlice {
  startChar: number;
  endChar: number;
}

interface GroupTarget {
  index: number;
  startSec: number;
  durationSec: number;
}

interface TranscriptRangeResult {
  index: number;
  startChar: number;
  endChar: number;
}

interface WordSpan {
  start: number;
  end: number;
}

const FIRST_GROUP_MAX_CHARS = 120;
const FIRST_GROUP_MIN_CHARS = 80;
const DEFAULT_GROUP_MAX_CHARS = 400;
const HIGHLIGHT_WINDOW_WORDS = 10;
const HIGHLIGHT_WINDOW_STRIDE = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function findSplitOffset(text: string): number | null {
  if (text.length <= FIRST_GROUP_MAX_CHARS) {
    return null;
  }

  const punctuationPatterns = [/([.!?])\s+/g, /([,;:])\s+/g];

  for (const pattern of punctuationPatterns) {
    let best = -1;
    for (const match of text.matchAll(pattern)) {
      const offset = (match.index ?? 0) + match[0].length;
      if (offset < FIRST_GROUP_MIN_CHARS || offset > FIRST_GROUP_MAX_CHARS) continue;
      best = offset;
    }
    if (best !== -1) {
      return best;
    }
  }

  return null;
}

function splitFirstGroup(groups: StreamGroup[]): StreamGroup[] {
  const first = groups[0];
  if (!first) return groups;

  const splitOffset = findSplitOffset(first.text);
  if (!splitOffset) return groups;

  const firstText = first.text.slice(0, splitOffset).trimEnd();
  const remainderText = first.text.slice(splitOffset).trimStart();
  if (!firstText || !remainderText) {
    return groups;
  }

  const replacement: StreamGroup[] = [
    {
      index: 0,
      text: firstText,
      startChar: first.startChar,
      endChar: first.startChar + firstText.length,
    },
    {
      index: 1,
      text: remainderText,
      startChar: first.endChar - remainderText.length,
      endChar: first.endChar,
    },
  ];

  const next = [...replacement, ...groups.slice(1)];
  return next.map((group, index) => ({
    ...group,
    index,
  }));
}

export function buildStreamGroups(text: string): StreamGroup[] {
  const groups = chunkTextWithBoundaries(text, DEFAULT_GROUP_MAX_CHARS).map((group) => ({
    index: group.index,
    text: group.text,
    startChar: group.startChar,
    endChar: group.endChar,
  }));

  return splitFirstGroup(groups);
}

export function estimateGroupDurationSec(group: StreamGroup): number {
  return Math.max(0.5, wordCount(group.text) * 0.42);
}

export function buildGroupHighlightSlices(group: StreamGroup): HighlightSlice[] {
  const text = group.text;
  const tokens: WordSpan[] = [];
  const tokenRegex = /\S+/g;

  let match = tokenRegex.exec(text);
  while (match) {
    const rawStart = match.index;
    const rawEnd = rawStart + match[0].length;
    let start = rawStart;
    let end = rawEnd;

    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;

    if (end > start) {
      tokens.push({ start, end });
    }

    match = tokenRegex.exec(text);
  }

  if (!tokens.length) {
    return [
      {
        startChar: group.startChar,
        endChar: group.endChar,
      },
    ];
  }

  const windowSize = Math.min(HIGHLIGHT_WINDOW_WORDS, tokens.length);
  const stride = Math.max(1, Math.min(HIGHLIGHT_WINDOW_STRIDE, windowSize));
  const slices: HighlightSlice[] = [];

  for (let startWord = 0; startWord < tokens.length; startWord += stride) {
    const endWord = Math.min(tokens.length - 1, startWord + windowSize - 1);
    const startChar = group.startChar + tokens[startWord].start;
    const endChar = group.startChar + tokens[endWord].end;
    if (endChar > startChar) {
      slices.push({ startChar, endChar });
    }
    if (endWord === tokens.length - 1) break;
  }

  const finalStartWord = Math.max(0, tokens.length - windowSize);
  const finalStartChar = group.startChar + tokens[finalStartWord].start;
  const finalEndChar = group.startChar + tokens[tokens.length - 1].end;
  const last = slices[slices.length - 1];

  if (!last || last.startChar !== finalStartChar || last.endChar !== finalEndChar) {
    slices.push({ startChar: finalStartChar, endChar: finalEndChar });
  }

  return slices;
}

export function resolveGroupTarget(
  groups: StreamGroup[],
  durationsSec: number[],
  positionSec: number
): GroupTarget {
  const targetSec = Math.max(0, positionSec);
  let accumulated = 0;

  for (let index = 0; index < groups.length; index += 1) {
    const durationSec = durationsSec[index] || estimateGroupDurationSec(groups[index]);
    if (targetSec <= accumulated + durationSec || index === groups.length - 1) {
      return {
        index,
        startSec: accumulated,
        durationSec,
      };
    }
    accumulated += durationSec;
  }

  const lastIndex = Math.max(0, groups.length - 1);
  return {
    index: lastIndex,
    startSec: accumulated,
    durationSec: durationsSec[lastIndex] || estimateGroupDurationSec(groups[lastIndex]),
  };
}

export function getDurationEstimate(groups: StreamGroup[], durationsSec: number[]): number {
  return groups.reduce(
    (total, group, index) => total + (durationsSec[index] || estimateGroupDurationSec(group)),
    0
  );
}

export function resolveTranscriptRange(
  groups: StreamGroup[],
  highlightSlices: HighlightSlice[][],
  durationsSec: number[],
  currentSec: number
): TranscriptRangeResult | null {
  if (!groups.length) return null;

  const target = resolveGroupTarget(groups, durationsSec, currentSec);
  const group = groups[target.index];
  if (!group) return null;

  const slices = highlightSlices[target.index] || [];
  if (!slices.length) {
    return {
      index: target.index,
      startChar: group.startChar,
      endChar: group.endChar,
    };
  }

  const localSec = clamp(currentSec - target.startSec, 0, Math.max(target.durationSec, 0.001));
  const ratio = localSec / Math.max(target.durationSec, 0.001);
  const sliceIndex = Math.min(slices.length - 1, Math.floor(ratio * slices.length));
  const activeSlice = slices[sliceIndex] || slices[0];

  return {
    index: target.index,
    startChar: activeSlice.startChar,
    endChar: activeSlice.endChar,
  };
}
