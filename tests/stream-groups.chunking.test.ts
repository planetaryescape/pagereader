import { describe, expect, it } from "vitest";
import { buildStreamGroups } from "@/lib/stream-groups";

describe("stream group chunking", () => {
  it("does not split the first group mid sentence just to hit the fast-start target", () => {
    const sentence =
      "This opening sentence intentionally keeps going past the fast start target without any early punctuation so the reader should wait for the real sentence boundary before sending audio.";

    const groups = buildStreamGroups(`${sentence} Second sentence follows cleanly.`);

    expect(groups[0]?.text.startsWith(sentence)).toBe(true);
    expect(groups[0]?.text.includes("Second sentence follows cleanly.") ?? false).toBe(true);
  });

  it("keeps moderately long single sentences intact", () => {
    const repeated = Array.from({ length: 70 }, (_, index) => `word${index}`).join(" ");
    const sentence = `${repeated}.`;

    const groups = buildStreamGroups(sentence);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.text).toBe(sentence);
  });
});
