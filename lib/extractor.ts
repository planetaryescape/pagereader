import { Readability } from "@mozilla/readability";

export interface ExtractedContent {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
}

export function extractPageContent(): ExtractedContent | null {
  // Clone document to avoid modifying the original
  const documentClone = document.cloneNode(true) as Document;

  const reader = new Readability(documentClone);
  const article = reader.parse();

  if (!article || !article.textContent) {
    return null;
  }

  // Clean up the text content
  const cleanedText = cleanTextForTTS(article.textContent);

  return {
    title: article.title || document.title,
    content: article.content || "",
    textContent: cleanedText,
    excerpt: article.excerpt || "",
  };
}

function cleanTextForTTS(text: string): string {
  return (
    text
      // Normalize whitespace
      .replace(/\s+/g, " ")
      // Remove multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      // Remove markdown-style formatting
      .replace(/[*_~`#]/g, "")
      // Remove URLs (they don't read well)
      .replace(/https?:\/\/[^\s]+/g, "")
      // Remove email addresses
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, "")
      // Clean up punctuation
      .replace(/([.!?])\1+/g, "$1")
      // Remove brackets with numbers (citations)
      .replace(/\[\d+\]/g, "")
      // Clean up dashes
      .replace(/\s*[-–—]\s*/g, " - ")
      // Trim
      .trim()
  );
}

export function getReadableLength(text: string): string {
  const words = text.split(/\s+/).length;
  const minutes = Math.ceil(words / 150); // ~150 words per minute for TTS
  return `${words} words, ~${minutes} min`;
}
