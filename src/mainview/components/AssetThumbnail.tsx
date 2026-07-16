import { Film, Music, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaAsset } from "@/store/useMediaPanelStore";

const typeIcons = {
  video: Film,
  audio: Music,
  image: ImageIcon,
};

const typeColors = {
  video: "text-white/50",
  audio: "text-white/50",
  image: "text-white/50",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface AssetThumbnailProps {
  asset: MediaAsset;
  selected?: boolean;
  onSelect?: (multi?: boolean) => void;
  size?: number;
}

export function AssetThumbnail({ asset, selected, onSelect, size = 80 }: AssetThumbnailProps) {
  const Icon = typeIcons[asset.type];
  const color = typeColors[asset.type];

  return (
    <div
      className={cn(
        "group relative rounded-lg overflow-hidden cursor-pointer transition-all",
        "bg-[#141414] border",
        selected ? "border-white/40 ring-1 ring-white/40" : "border-[#1C1C1C] hover:border-gray-600"
      )}
      style={{ aspectRatio: "1" }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({
          kind: "media-asset",
          id: asset.id,
          type: asset.type,
          url: asset.url,
          name: asset.name,
          duration: asset.duration,
        }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={(e) => onSelect?.(e.metaKey || e.ctrlKey)}
      onDoubleClick={() => {/* open/preview */}}
    >
      {/* Thumbnail or placeholder */}
      {asset.thumbnailUrl ? (
        <img
          src={asset.thumbnailUrl}
          alt={asset.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Icon size={size * 0.3} className={cn(color, "opacity-40")} />
        </div>
      )}

      {/* Generating overlay */}
      {asset.isGenerated && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      )}

      {/* Type badge */}
      <div className="absolute top-1 left-1">
        <div className="w-5 h-5 rounded bg-black/60 flex items-center justify-center">
          <Icon size={10} className={color} />
        </div>
      </div>

      {/* Duration badge */}
      {asset.duration > 0 && (asset.type === "video" || asset.type === "audio") && (
        <div className="absolute bottom-1 right-1">
          <span className="px-1 py-0.5 rounded text-[9px] font-mono bg-black/70 text-white/80">
            {formatDuration(asset.duration)}
          </span>
        </div>
      )}

      {/* Selection ring */}
      {selected && (
        <div className="absolute inset-0 border-2 border-white/40 rounded-lg pointer-events-none" />
      )}

      {/* Name */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
        <p className="text-[10px] text-white/90 truncate">{asset.name}</p>
      </div>
    </div>
  );
}
