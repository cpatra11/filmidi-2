import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { computeWaveformPeaks } from "@/lib/webAudio";

interface WaveformProps {
  peaks: Float32Array | number[];
  width: number;
  height: number;
  className?: string;
  color?: string;
  barWidth?: number;
  barGap?: number;
}

export function Waveform({
  peaks,
  width,
  height,
  className,
  color = "#FFFFFF",
  barWidth = 2,
  barGap = 1,
}: WaveformProps) {
  const bars = useMemo(() => {
    const maxBars = Math.floor(width / (barWidth + barGap));
    const sampled = new Float32Array(maxBars);
    const step = Math.max(1, Math.floor(peaks.length / maxBars));
    for (let i = 0; i < maxBars; i++) {
      const idx = Math.min(Math.floor(i * step), peaks.length - 1);
      sampled[i] = peaks[idx] ?? 0;
    }
    return sampled;
  }, [peaks, width, barWidth, barGap]);

  const midY = height / 2;
  const scale = height * 0.45;

  return (
    <svg
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      viewBox={`0 0 ${width} ${height}`}
    >
      {Array.from({ length: bars.length }, (_, i) => {
        const x = i * (barWidth + barGap);
        const val = Math.max(0.01, Math.min(1, Math.abs(bars[i])));
        const h = val * scale;
        const y = midY - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={h * 2}
            rx={barWidth > 1 ? 0.5 : 0}
            fill={color}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}

export function useWaveformPeaks(
  audioBuffer: AudioBuffer | null,
  samplesPerSecond: number = 200,
): Float32Array | null {
  return useMemo(() => {
    if (!audioBuffer) return null;
    const channel = audioBuffer.getChannelData(0);
    return computeWaveformPeaks(channel, samplesPerSecond, audioBuffer.sampleRate);
  }, [audioBuffer, samplesPerSecond]);
}
