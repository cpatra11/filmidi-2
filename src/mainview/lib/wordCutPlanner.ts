/**
 * Word cut planner for text-based editing (remove_words).
 * Matches Swift's WordCutPlanner algorithm.
 */

export interface WordEntry {
  index: number;
  text: string;
  startFrame: number;
  endFrame: number;
  selected: boolean;
  clipId: string;
}

export interface CutRange {
  startFrame: number;
  endFrame: number;
  clipId: string;
}

/** Gap duration in ms for each aggressiveness level. Matches Swift's WordCutAggressiveness. */
const GAP_MS: Record<string, number> = {
  tight: 60,
  balanced: 150,
  loose: 320,
};

/**
 * Plan cut ranges from selected words.
 * Matches Swift's WordCutPlanner.cutRanges().
 */
export function planWordCuts(
  words: WordEntry[],
  fps: number,
  clipStartFrame: number,
  clipEndFrame: number,
  aggressiveness: string = "balanced"
): CutRange[] {
  const keepGapMs = GAP_MS[aggressiveness] ?? GAP_MS.balanced;
  const keepGapFrames = Math.round((keepGapMs / 1000) * fps);
  const halfGap = Math.floor(keepGapFrames / 2);

  // Sort words by startFrame
  const sorted = [...words].sort((a, b) => a.startFrame - b.startFrame);

  const ranges: CutRange[] = [];
  let i = 0;

  while (i < sorted.length) {
    // Skip unselected words
    if (!sorted[i].selected) {
      i++;
      continue;
    }

    // Find run of consecutive selected words
    const runStart = i;
    while (i < sorted.length && sorted[i].selected) {
      i++;
    }
    const runEnd = i - 1;

    // Boundaries: previous unselected word's end / next unselected word's start
    const leftBoundary = runStart > 0 ? sorted[runStart - 1].endFrame : clipStartFrame;
    const rightBoundary = runEnd < sorted.length - 1 ? sorted[runEnd + 1].startFrame : clipEndFrame;

    // Compute safe keep zones
    const gapBefore = Math.min(sorted[runStart].startFrame - leftBoundary, halfGap);
    const gapAfter = Math.min(rightBoundary - sorted[runEnd].endFrame, halfGap);

    const rangeStart = Math.max(clipStartFrame, leftBoundary + gapBefore);
    const rangeEnd = Math.min(clipEndFrame, rightBoundary - gapAfter);

    if (rangeEnd > rangeStart) {
      ranges.push({
        startFrame: rangeStart,
        endFrame: rangeEnd,
        clipId: sorted[runStart].clipId,
      });
    }
  }

  return mergeRanges(ranges);
}

/** Merge overlapping cut ranges. */
function mergeRanges(ranges: CutRange[]): CutRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startFrame - b.startFrame);
  const merged: CutRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.startFrame <= last.endFrame && curr.clipId === last.clipId) {
      last.endFrame = Math.max(last.endFrame, curr.endFrame);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Find words matching exact tokens (for matches: ["um", "uh"]).
 * Returns indices of matching words.
 */
export function findMatchingWords(
  words: Array<{ text: string; index: number }>,
  tokens: string[]
): number[] {
  const normalized = tokens.map((t) => t.trim().toLowerCase().replace(/[^\w]/g, ""));
  const matchSet = new Set(normalized);

  return words
    .filter((w) => matchSet.has(w.text.trim().toLowerCase().replace(/[^\w]/g, "")))
    .map((w) => w.index);
}
