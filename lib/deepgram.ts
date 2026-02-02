const DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";

export interface DeepgramOptions {
  apiKey: string;
  voice: string;
  speed?: number;
}

// Chunk text at sentence boundaries, max ~1500 chars
export function chunkText(text: string, maxChars = 1500): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  let currentChunk = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length > maxChars && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmed;
    } else {
      currentChunk += (currentChunk ? " " : "") + trimmed;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export async function synthesizeSpeech(
  text: string,
  options: DeepgramOptions
): Promise<ArrayBuffer> {
  const { apiKey, voice, speed = 1.0 } = options;

  const params = new URLSearchParams({
    model: voice,
    encoding: "mp3",
  });

  const url = `${DEEPGRAM_TTS_URL}?${params}`;
  console.log("[PageReader] Calling DeepGram:", url);
  console.log("[PageReader] Voice:", voice, "Text preview:", text.substring(0, 100));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "text/plain",
    },
    body: text,
  });

  console.log("[PageReader] Response status:", response.status);
  console.log("[PageReader] Response content-type:", response.headers.get("content-type"));

  if (!response.ok) {
    const error = await response.text();
    console.error("[PageReader] API error:", error);
    throw new Error(`DeepGram TTS error: ${response.status} - ${error}`);
  }

  const buffer = await response.arrayBuffer();
  console.log("[PageReader] Received buffer size:", buffer.byteLength);
  return buffer;
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await synthesizeSpeech("Test", { apiKey, voice: "aura-asteria-en" });
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
