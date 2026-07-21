import { describe, expect, test } from "bun:test";
import { normalizeVideoFlowDocument, validateVideoFlowDocument } from "./videoFlowDocument";

describe("VideoFlow document adapter", () => {
  test("normalizes long timelines and speed without losing layer bounds", () => {
    const result = normalizeVideoFlowDocument({
      fps: 30,
      width: 1920,
      height: 1080,
      duration: 2,
      layers: [{ id: "clip", type: "video", track: 10, startTime: 120, sourceDuration: 12, settings: { speed: 2, sourceStart: 3 } }],
    });

    expect(result.duration).toBe(126);
    expect(result.layers[0].settings.sourceStart).toBe(3);
    expect((result.layers[0] as any).duration).toBe(6);
  });

  test("sorts animation starts and preserves text and shape layers without sources", () => {
    const result = normalizeVideoFlowDocument({
      fps: 30,
      width: 100,
      height: 100,
      duration: 1,
      layers: [{ type: "text", startTime: 0, sourceDuration: 1, animations: [{ startTime: 2 }, { startTime: 0 }] }],
    });
    expect(result.layers[0].animations.map((item: any) => item.startTime)).toEqual([0, 2]);
    expect(validateVideoFlowDocument(result).valid).toBe(true);
  });

  test("reports missing media sources", () => {
    const result = validateVideoFlowDocument({ fps: 30, width: 1920, height: 1080, layers: [{ type: "video", startTime: 0, sourceDuration: 1 }] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("missing a media source");
  });
});
