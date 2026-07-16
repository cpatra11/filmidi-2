import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface FolderTileProps {
  name: string;
  childCount?: number;
  onOpen?: () => void;
}

export function FolderTile({ name, childCount, onOpen }: FolderTileProps) {
  return (
    <div
      className={cn(
        "group relative rounded-lg overflow-hidden cursor-pointer transition-all",
        "bg-[#141414] border border-[#1C1C1C] hover:border-gray-600"
      )}
      style={{ aspectRatio: "1" }}
      onClick={onOpen}
    >
      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
        <Folder size={24} className="text-white opacity-60 group-hover:opacity-100 transition-opacity" />
        {childCount !== undefined && childCount > 0 && (
          <span className="text-[9px] text-gray-500">{childCount}</span>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
        <p className="text-[10px] text-white/90 truncate">{name}</p>
      </div>
    </div>
  );
}
