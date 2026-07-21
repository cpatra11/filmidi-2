import { describe, expect, test } from "bun:test";
import { clampTimelineFrame, getTimelineDuration } from "./timelineMetrics";

describe("timeline metrics", () => {
  test("includes layers beyond stale project duration", () => {
    const video = {
      duration: 8,
      fps: 30,
      layers: [{ type: "video", track: 10, settings: { startTime: 12, sourceDuration: 4 } }],
    };
    expect(getTimelineDuration(video)).toBe(16);
    expect(clampTimelineFrame(video, 999)).toBe(479);
  });

  test("clamps negative and fractional frame values", () => {
    const video = { duration: 2, fps: 30, layers: [] };
    expect(clampTimelineFrame(video, -2)).toBe(0);
    expect(clampTimelineFrame(video, 12.6)).toBe(13);
    expect(clampTimelineFrame(video, 99)).toBe(59);
  });
});
