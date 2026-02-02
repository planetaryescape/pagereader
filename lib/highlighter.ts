const HIGHLIGHT_CLASS = "pagereader-highlight";
const HIGHLIGHT_STYLE_ID = "pagereader-highlight-style";

// Inject highlight styles into the main document
function ensureStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: linear-gradient(120deg, #a78bfa 0%, #818cf8 100%) !important;
      color: white !important;
      padding: 2px 4px !important;
      border-radius: 3px !important;
      box-shadow: 0 2px 8px rgba(167, 139, 250, 0.4) !important;
    }
  `;
  document.head.appendChild(style);
  console.log("[PageReader] Highlight styles injected");
}

// Find the article/main content area
function findContentRoot(): Element | null {
  const selectors = [
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

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      console.log("[PageReader] Found content root:", selector);
      return el;
    }
  }

  console.log("[PageReader] Using body as content root");
  return document.body;
}

// Normalize text for comparison
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces (not remove)
    .replace(/\s+/g, " ")
    .trim();
}

// Get first N words from text
function getFirstWords(text: string, n: number): string {
  return normalize(text).split(" ").slice(0, n).join(" ");
}

// Check if element is a leaf text element (contains text directly, not just via children)
function isLeafTextElement(el: Element): boolean {
  // Must have some text content
  const text = el.textContent?.trim();
  if (!text || text.length < 20) return false;

  // Prefer p, li, h1-h6, blockquote, td - actual text containers
  const tag = el.tagName.toLowerCase();
  if (["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "td", "th", "figcaption"].includes(tag)) {
    return true;
  }

  // For div/span, only match if it doesn't contain block-level children
  if (["div", "span", "section"].includes(tag)) {
    const hasBlockChildren = el.querySelector("p, div, article, section, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6");
    return !hasBlockChildren;
  }

  return false;
}

let currentHighlight: Element | null = null;

export function highlightChunk(chunkText: string): void {
  console.log("[PageReader] highlightChunk called, text length:", chunkText.length);

  ensureStyles();
  clearHighlights();

  const root = findContentRoot();
  if (!root) {
    console.log("[PageReader] No content root found");
    return;
  }

  // Get searchable first words from chunk
  const searchWords = getFirstWords(chunkText, 10);
  console.log("[PageReader] Searching for:", searchWords);

  // First pass: look for paragraphs and other text-specific elements
  const textElements = root.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, figcaption");
  console.log("[PageReader] Found", textElements.length, "text elements");

  for (const el of textElements) {
    const elText = el.textContent || "";
    if (elText.length < 20) continue;

    const elNormalized = normalize(elText);

    if (elNormalized.includes(searchWords)) {
      console.log("[PageReader] Match found:", el.tagName, elText.substring(0, 50));

      el.classList.add(HIGHLIGHT_CLASS);
      currentHighlight = el;

      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      return;
    }
  }

  // Second pass: try divs/spans that are leaf nodes
  const allElements = root.querySelectorAll("div, span, section");
  console.log("[PageReader] Fallback: checking", allElements.length, "div/span elements");

  for (const el of allElements) {
    if (!isLeafTextElement(el)) continue;

    const elText = el.textContent || "";
    const elNormalized = normalize(elText);

    if (elNormalized.includes(searchWords)) {
      console.log("[PageReader] Fallback match:", el.tagName, elText.substring(0, 50));

      el.classList.add(HIGHLIGHT_CLASS);
      currentHighlight = el;

      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      return;
    }
  }

  console.log("[PageReader] No highlight match found");
}

export function clearHighlights(): void {
  if (currentHighlight) {
    currentHighlight.classList.remove(HIGHLIGHT_CLASS);
    currentHighlight = null;
  }

  // Also clear any stray highlights
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
}
