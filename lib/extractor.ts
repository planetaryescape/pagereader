import { Readability } from "@mozilla/readability";
import { getPageTextModel } from "./page-text-model";

export interface ExtractedContent {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extractPageContent(): ExtractedContent | null {
  const model = getPageTextModel();
  if (model?.textContent) {
    return {
      title: model.title,
      content: "",
      textContent: model.textContent,
      excerpt: "",
    };
  }

  // Fallback for pages where a live root cannot be resolved well enough.
  const documentClone = document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();
  if (!article || !article.textContent) {
    return null;
  }

  const cleanedText = cleanTextForTTS(article.textContent);

  return {
    title: article.title || document.title,
    content: article.content || "",
    textContent: cleanedText,
    excerpt: article.excerpt || "",
  };
}

function cleanTextForTTS(text: string): string {
  const paragraphMarker = "\u0000";
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{2,}/g, paragraphMarker)
    .replace(/\n/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(new RegExp(paragraphMarker, "g"), "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getReadableLength(text: string): string {
  const words = text.split(/\s+/).length;
  const minutes = Math.ceil(words / 150); // ~150 words per minute for TTS
  return `${words} words, ~${minutes} min`;
}

export function normalizeContentForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function hashContent(text: string): Promise<string> {
  const normalized = normalizeContentForHash(text);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

export function canonicalizePageUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl.split("#")[0];
  }
}
