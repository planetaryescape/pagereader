import { describe, expect, it } from "vitest";
import { clearHighlights, highlightChunk, highlightRange } from "@/lib/highlighter";

describe("highlighter robustness", () => {
  it("highlights anchor text across nested inline nodes", () => {
    document.body.innerHTML = `
      <article>
        <p>
          Intro text.
          <span>The quick</span>
          <strong>brown fox</strong>
          <em>jumps over</em>
          <span>the lazy dog near river bank.</span>
        </p>
      </article>
    `;

    clearHighlights();
    const result = highlightChunk(
      "The quick brown fox jumps over the lazy dog near river bank and keeps running."
    );

    expect(result.matched).toBe(true);
    expect(document.querySelector(".pagereader-highlight")).toBeTruthy();
  });

  it("returns unmatched result without throwing when no anchor can be found", () => {
    document.body.innerHTML = "<main><p>Completely different content only.</p></main>";
    clearHighlights();

    const result = highlightChunk("this anchor does not exist anywhere on page");
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("no-anchor");
  });

  it("advances highlight forward for repeated anchors as playback progresses", () => {
    document.body.innerHTML = `
      <article>
        <p id="first">Before target phrase appears in the first paragraph.</p>
        <p id="second">Before target phrase appears in the second paragraph.</p>
      </article>
    `;
    clearHighlights();

    const first = highlightChunk("target phrase appears in the first paragraph");
    expect(first.matched).toBe(true);
    const firstHighlight = document.querySelector(".pagereader-highlight");
    expect(firstHighlight?.closest("p")?.id).toBe("first");

    const second = highlightChunk("target phrase appears in the second paragraph");
    expect(second.matched).toBe(true);
    const secondHighlight = document.querySelector(".pagereader-highlight");
    expect(secondHighlight?.closest("p")?.id).toBe("second");
  });

  it("does not jump back to first sentence when next chunk cannot be matched forward", () => {
    document.body.innerHTML = `
      <article>
        <p id="first">alpha beta gamma delta epsilon zeta eta theta iota kappa.</p>
        <p id="second">different words in the second paragraph only.</p>
      </article>
    `;
    clearHighlights();

    const first = highlightChunk("alpha beta gamma delta epsilon zeta eta theta iota kappa");
    expect(first.matched).toBe(true);
    expect(document.querySelector(".pagereader-highlight")?.closest("p")?.id).toBe("first");

    const unmatchedNext = highlightChunk(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa plus nonexistent tail"
    );
    expect(unmatchedNext.matched).toBe(false);
    expect(unmatchedNext.reason).toBe("no-anchor");
    expect(document.querySelector(".pagereader-highlight")).toBeNull();

    const unmatchedAgain = highlightChunk(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa plus another missing tail"
    );
    expect(unmatchedAgain.matched).toBe(false);
    expect(unmatchedAgain.reason).toBe("no-anchor");
    expect(document.querySelector(".pagereader-highlight")).toBeNull();
  });

  it("uses custom highlights without injecting wrapper elements when supported", () => {
    document.body.innerHTML = "<article><p>alpha beta gamma delta</p></article>";

    const originalCSS = globalThis.CSS;
    const originalHighlight = globalThis.Highlight;
    const highlights = new Map<string, unknown>();

    class HighlightPolyfill {
      ranges: Range[];

      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }

    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { highlights },
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: HighlightPolyfill,
    });

    try {
      clearHighlights();
      const result = highlightRange(6, 10);

      expect(result.matched).toBe(true);
      expect(highlights.size).toBe(1);
      expect(document.querySelector(".pagereader-highlight")).toBeNull();

      clearHighlights();
      expect(highlights.size).toBe(0);
    } finally {
      if (originalCSS === undefined) {
        Reflect.deleteProperty(globalThis as Record<string, unknown>, "CSS");
      } else {
        Object.defineProperty(globalThis, "CSS", {
          configurable: true,
          value: originalCSS,
        });
      }

      if (originalHighlight === undefined) {
        Reflect.deleteProperty(globalThis as Record<string, unknown>, "Highlight");
      } else {
        Object.defineProperty(globalThis, "Highlight", {
          configurable: true,
          value: originalHighlight,
        });
      }
    }
  });
});
