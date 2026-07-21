import { requestNativeMedia } from "./nativeMediaBridge";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export interface StoredMedia {
  path: string;
  url: string;
}

export async function storeImportedFile(file: File, assetId: string): Promise<StoredMedia | null> {
  try {
    const result = await requestNativeMedia<StoredMedia>("store-media", {
      assetId,
      fileName: file.name,
      mimeType: file.type,
      base64Data: toBase64(new Uint8Array(await file.arrayBuffer())),
    });
    return result?.url ? result : null;
  } catch (error) {
    console.warn("[media-storage] failed to persist imported media", error);
    return null;
  }
}

export async function storeDataUrl(dataUrl: string, fileName: string, assetId: string): Promise<StoredMedia | null> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  return requestNativeMedia<StoredMedia>("store-media", {
    assetId,
    fileName,
    mimeType: dataUrl.slice(5, comma).split(";")[0],
    base64Data: dataUrl.slice(comma + 1),
  });
}

export async function storeRemoteMedia(url: string, fileName: string, assetId: string): Promise<StoredMedia | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return storeImportedFile(new File([blob], fileName, { type: blob.type }), assetId);
  } catch (error) {
    console.warn("[media-storage] failed to persist remote media", error);
    return null;
  }
}
