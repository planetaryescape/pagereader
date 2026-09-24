export interface PageTextModel {
  title: string;
  root: HTMLElement;
  rawText: string;
  textContent: string;
  cleanToRaw: number[];
  textNodes: Array<{
    node: Text;
    start: number;
    end: number;
  }>;
}

const ROOT_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  '[role="article"]',
  ".post-content",
  ".article-content",
  ".entry-content",
  ".content",
  "#content",
  ".post",
  ".article",
];

let cachedModel: PageTextModel | null = null;

function collectRawText(root: HTMLElement): {
  rawText: string;
  textNodes: Array<{
    node: Text;
    start: number;
    end: number;
  }>;
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: PageTextModel["textNodes"] = [];
  const parts: string[] = [];
  let offset = 0;

  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && current.data) {
      const value = current.data;
      parts.push(value);
      textNodes.push({
        node: current,
        start: offset,
        end: offset + value.length,
      });
      offset += value.length;
    }
    current = walker.nextNode();
  }

  return {
    rawText: parts.join(""),
    textNodes,
  };
}

function getRootLength(element: HTMLElement): number {
  return element.innerText?.trim().length || element.textContent?.trim().length || 0;
}

function findContentRoot(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLength = 0;

  for (const selector of ROOT_SELECTORS) {
    const elements = Array.from(document.querySelectorAll(selector));
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      const length = getRootLength(element);
      if (length > bestLength) {
        best = element;
        bestLength = length;
      }
    }
  }

  if (best) {
    return best;
  }

  return document.body instanceof HTMLElement ? document.body : null;
}

function normalizeTextWithOffsets(rawText: string): {
  text: string;
  cleanToRaw: number[];
} {
  const chars: string[] = [];
  const cleanToRaw: number[] = [];
  let pendingSpaceOffset: number | null = null;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (/\s/.test(char)) {
      if (chars.length > 0 && pendingSpaceOffset === null) {
        pendingSpaceOffset = index;
      }
      continue;
    }

    if (pendingSpaceOffset !== null) {
      chars.push(" ");
      cleanToRaw.push(pendingSpaceOffset);
      pendingSpaceOffset = null;
    }

    chars.push(char);
    cleanToRaw.push(index);
  }

  cleanToRaw.push(rawText.length);

  return {
    text: chars.join(""),
    cleanToRaw,
  };
}

export function clearPageTextModel(): void {
  cachedModel = null;
}

export function getPageTextModel(): PageTextModel | null {
  if (cachedModel && document.contains(cachedModel.root)) {
    const nextRawText = cachedModel.root.textContent || "";
    if (nextRawText === cachedModel.rawText) {
      return cachedModel;
    }
  }

  const root = findContentRoot();
  if (!root) {
    cachedModel = null;
    return null;
  }

  const { rawText, textNodes } = collectRawText(root);
  const normalized = normalizeTextWithOffsets(rawText);

  if (!normalized.text.trim()) {
    cachedModel = null;
    return null;
  }

  cachedModel = {
    title: document.title,
    root,
    rawText,
    textContent: normalized.text,
    cleanToRaw: normalized.cleanToRaw,
    textNodes,
  };

  return cachedModel;
}

export function getRawOffsetForCleanIndex(model: PageTextModel, index: number): number {
  if (!model.cleanToRaw.length) {
    return 0;
  }

  const bounded = Math.max(0, Math.min(index, model.cleanToRaw.length - 1));
  return model.cleanToRaw[bounded] ?? model.rawText.length;
}

export function getDomRangeForRawOffsets(
  model: PageTextModel,
  start: number,
  end: number
): Range | null {
  if (!model.textNodes.length) {
    return null;
  }

  const boundedStart = Math.max(0, Math.min(start, model.rawText.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, model.rawText.length));

  const startPosition = resolveTextPosition(model, boundedStart);
  const endPosition = resolveTextPosition(model, boundedEnd);
  if (!startPosition || !endPosition) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  return range;
}

function resolveTextPosition(
  model: PageTextModel,
  rawOffset: number
): {
  node: Text;
  offset: number;
} | null {
  for (const entry of model.textNodes) {
    if (rawOffset < entry.end) {
      return {
        node: entry.node,
        offset: rawOffset - entry.start,
      };
    }

    if (rawOffset === entry.end) {
      return {
        node: entry.node,
        offset: entry.node.data.length,
      };
    }
  }

  const last = model.textNodes[model.textNodes.length - 1];
  if (!last) {
    return null;
  }

  return {
    node: last.node,
    offset: last.node.data.length,
  };
}
