import { describe, expect, test } from "bun:test";
import {
  buildLinkedMoveUpdates,
  buildSwapMoveUpdates,
  buildTimelineMovePlan,
  normalizeTrackForKind,
  validateMoveUpdates,
} from "./timelineMove";

function layer(id: string, type: string, track: number, startTime: number, sourceDuration: number, linkId?: string) {
  return {
    id,
    type,
    track,
    settings: {
      startTime,
      sourceDuration,
      sourceStart: 0,
      enabled: true,
      ...(linkId ? { linkId } : {}),
    },
  };
}

describe("timeline move helpers", () => {
  test("normalizes tracks by layer type", () => {
    expect(normalizeTrackForKind(0, "video")).toBe(10);
    expect(normalizeTrackForKind(10, "audio")).toBe(0);
  });

  test("moves linked video and audio by time while keeping typed tracks", () => {
    const layers = [
      layer("a1", "audio", 0, 0, 3, "link-a"),
      layer("v1", "video", 10, 0, 3, "link-a"),
    ];

    const updates = buildLinkedMoveUpdates(layers, "v1", 5, 11);

    expect(updates).toEqual([
      { id: "v1", startTime: 5, track: 11 },
      { id: "a1", startTime: 5, track: 1 },
    ]);
    expect(validateMoveUpdates(layers, updates).ok).toBe(true);
  });

  test("plans same-track swaps for linked edit units", () => {
    const layers = [
      layer("a1", "audio", 0, 0, 3, "link-a"),
      layer("v1", "video", 10, 0, 3, "link-a"),
      layer("a2", "audio", 0, 3, 2, "link-b"),
      layer("v2", "video", 10, 3, 2, "link-b"),
    ];

    const updates = buildSwapMoveUpdates(layers, "v2", "v1");

    expect(updates).toEqual([
      { id: "v2", startTime: 0 },
      { id: "a2", startTime: 0 },
      { id: "v1", startTime: 3 },
      { id: "a1", startTime: 3 },
    ]);
    expect(validateMoveUpdates(layers, updates).ok).toBe(true);
  });

  test("turns same-track collision into swap plan", () => {
    const layers = [
      layer("v1", "video", 10, 0, 3),
      layer("v2", "video", 10, 3, 2),
    ];

    const plan = buildTimelineMovePlan(layers, "v2", 1, 10, "swap");

    expect(plan.mode).toBe("swap");
    expect(plan.swapTargetId).toBe("v1");
    expect(plan.updates).toEqual([
      { id: "v2", startTime: 0 },
      { id: "v1", startTime: 3 },
    ]);
  });
});
