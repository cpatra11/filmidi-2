import { describe, expect, test } from "bun:test";
import { wordsFromSegments } from "./cloudTranscription";

describe("cloud transcription normalization", () => {
  test("derives stable word boundaries from segment-only Gateway responses", () => {
    const words = wordsFromSegments([{ text: "hello calm world", start: 1, end: 2.5 }]);
    expect(words.map((word) => word.text)).toEqual(["hello", "calm", "world"]);
    expect(words[0].start).toBe(1);
    expect(words[2].end).toBe(2.5);
    expect(words[0].end).toBeLessThanOrEqual(words[1].start);
  });

  test("keeps gaps between segments for silence detection", () => {
    const words = wordsFromSegments([
      { text: "before", start: 0, end: 0.4 },
      { text: "after", start: 1.2, end: 1.6 },
    ]);
    expect(words[1].start - words[0].end).toBeCloseTo(0.8);
  });
});
