/**
 * Track linking utilities for video+audio layer pairs.
 *
 * When a video is added to the timeline, two layers are created:
 *   - A video layer (visual)
 *   - An audio layer (sound from the same source)
 *
 * Both layers share a `linkId` stored in their settings. This allows
 * linked operations: move, split, delete, mute, etc.
 */

import { useEditorStore } from "@videoflow/react-video-editor";

let linkCounter = 0;

/** Generate a unique link ID for a new video+audio pair. */
export function generateLinkId(): string {
  return `link-${Date.now()}-${++linkCounter}`;
}

/** Read the linkId from a layer's settings. */
export function getLayerLinkId(layer: any): string | undefined {
  return layer?.settings?.linkId as string | undefined;
}

/** Set the linkId on a layer via setSettingCommand. */
export async function setLayerLinkId(
  commit: any,
  layerId: string,
  linkId: string,
  setSettingCommand: (commit: any, id: string, name: string, value: unknown) => Promise<void>,
): Promise<void> {
  await setSettingCommand(commit, layerId, "linkId", linkId);
}

/** Find the linked partner of a layer. Returns the partner layer or undefined. */
export function findLinkedPartner(layerId: string): any | undefined {
  const editor = useEditorStore.getState();
  const layers = editor.video.layers ?? [];
  const layer = layers.find((l: any) => l.id === layerId);
  if (!layer) return undefined;

  const linkId = getLayerLinkId(layer);
  if (!linkId) return undefined;

  // Find the other layer with the same linkId
  return layers.find((l: any) => l.id !== layerId && getLayerLinkId(l) === linkId);
}

/** Find the linked partner of a layer, given an explicit layers array. */
export function findLinkedPartnerIn(layers: any[], layerId: string): any | undefined {
  const layer = layers.find((l: any) => l.id === layerId);
  if (!layer) return undefined;

  const linkId = getLayerLinkId(layer);
  if (!linkId) return undefined;

  return layers.find((l: any) => l.id !== layerId && getLayerLinkId(l) === linkId);
}

/** Check if a layer has a linked partner. */
export function hasLinkedPartner(layerId: string): boolean {
  return findLinkedPartner(layerId) !== undefined;
}

/** Remove linkId from both a layer and its partner. */
export async function unlinkLayers(
  layerId: string,
  commit: any,
  setSettingCommand: (commit: any, id: string, name: string, value: unknown) => Promise<void>,
): Promise<string | null> {
  const partner = findLinkedPartner(layerId);
  const linkId = getLayerLinkId(partner ?? findLinkedPartnerBySearching(layerId));

  // Clear linkId from both
  await setSettingCommand(commit, layerId, "linkId", undefined);
  if (partner) {
    await setSettingCommand(commit, partner.id, "linkId", undefined);
  }

  return linkId ?? null;
}

/** Internal helper to find partner by searching layers directly. */
function findLinkedPartnerBySearching(layerId: string): any | undefined {
  const editor = useEditorStore.getState();
  const layers = editor.video.layers ?? [];
  return findLinkedPartnerIn(layers, layerId);
}
