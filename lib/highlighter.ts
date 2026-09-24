import Mark from "mark.js";
import {
  getDomRangeForRawOffsets,
  PageTextModel,
  getPageTextModel,
  getRawOffsetForCleanIndex,
} from "./page-text-model";

const HIGHLIGHT_CLASS = "pagereader-highlight";
const HIGHLIGHT_STYLE_ID = "pagereader-highlight-style";
const HIGHLIGHT_NAME = "pagereader-highlight";

export interface HighlightResult {
  matched: boolean;
  reason?: "no-root" | "no-anchor" | "mark-failed";
}

let lastChunkSearchOffset = 0;

function ensureStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background-color: rgba(14, 165, 233, 0.28);
      color: inherit;
    }

    .${HIGHLIGHT_CLASS} {
      background-color: rgba(14, 165, 233, 0.28) !important;
      color: inherit !important;
      transition: background-color 120ms ease !important;
    }
  `;
  document.head.appendChild(style);
}

function supportsCustomHighlights(): boolean {
  return typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;
}

function clearCustomHighlight(): void {
  if (!supportsCustomHighlights()) return;
  CSS.highlights.delete(HIGHLIGHT_NAME);
}

function unmarkCurrent(root: HTMLElement): void {
  const marker = new Mark(root);
  marker.unmark({ className: HIGHLIGHT_CLASS });
}

function highlightDomRange(range: Range): HighlightResult {
  if (!supportsCustomHighlights()) {
    return { matched: false, reason: "mark-failed" };
  }

  const highlight = new Highlight(range);
  CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  return { matched: true };
}

function markRange(root: HTMLElement, start: number, length: number): HighlightResult {
  if (length <= 0) {
    return { matched: false, reason: "no-anchor" };
  }

  const marker = new Mark(root);
  let matched = false;

  marker.markRanges(
    [{ start, length }],
    {
      className: HIGHLIGHT_CLASS,
      done: (count) => {
        if (count > 0) {
          matched = true;
        }
      },
    }
  );

  return matched ? { matched: true } : { matched: false, reason: "mark-failed" };
}

function resolveModel(explicitModel?: PageTextModel | null): PageTextModel | null {
  return explicitModel || getPageTextModel();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightRange(
  startChar: number,
  endChar: number,
  explicitModel?: PageTextModel | null
): HighlightResult {
  try {
    ensureStyles();
    const model = resolveModel(explicitModel);
    if (!model?.root) {
      return { matched: false, reason: "no-root" };
    }

    const rawStart = getRawOffsetForCleanIndex(model, startChar);
    const rawEnd = getRawOffsetForCleanIndex(model, endChar);
    const length = Math.max(0, rawEnd - rawStart);

    clearCustomHighlight();
    unmarkCurrent(model.root);
    if (length <= 0) {
      return { matched: false, reason: "no-anchor" };
    }

    const domRange = supportsCustomHighlights() ? getDomRangeForRawOffsets(model, rawStart, rawEnd) : null;
    if (domRange) {
      return highlightDomRange(domRange);
    }

    return markRange(model.root, rawStart, length);
  } catch {
    return { matched: false, reason: "mark-failed" };
  }
}

export function highlightChunk(chunkText: string, explicitModel?: PageTextModel | null): HighlightResult {
  const model = resolveModel(explicitModel);
  if (!model) {
    return { matched: false, reason: "no-root" };
  }

  const trimmed = chunkText.trim();
  if (!trimmed) {
    return { matched: false, reason: "no-anchor" };
  }

  const normalizedChunk = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'’]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chunkWords = normalizedChunk.split(" ").filter(Boolean);
  if (!chunkWords.length) {
    return { matched: false, reason: "no-anchor" };
  }

  const anchors: string[] = [];
  anchors.push(chunkWords.slice(0, Math.min(chunkWords.length, 10)).join(" "));
  if (chunkWords.length > 12) {
    const midpoint = Math.max(0, Math.floor(chunkWords.length / 2) - 4);
    anchors.push(chunkWords.slice(midpoint, midpoint + 8).join(" "));
  }

  for (const anchor of anchors) {
    const pattern = anchor
      .split(/\s+/)
      .map((word) => `\\b${escapeRegex(word)}\\b`)
      .join("[\\W\\s]+");
    const regex = new RegExp(pattern, "giu");
    regex.lastIndex = Math.max(0, lastChunkSearchOffset);
    const match = regex.exec(model.textContent);
    if (!match || typeof match.index !== "number") continue;
    const start = match.index;
    const end = start + match[0].length;
    const result = highlightRange(start, end, model);
    if (result.matched) {
      lastChunkSearchOffset = end;
    }
    return result;
  }

  if (model.root) {
    unmarkCurrent(model.root);
  }
  return { matched: false, reason: "no-anchor" };
}

export function clearHighlights(): void {
  clearCustomHighlight();
  const marker = new Mark(document.body);
  marker.unmark({ className: HIGHLIGHT_CLASS });
  lastChunkSearchOffset = 0;
}
