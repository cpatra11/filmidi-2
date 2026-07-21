import { listEffects, listTransitions } from "@videoflow/renderer-browser";

export function getVideoFlowCapabilities() {
  return {
    effects: listEffects().slice().sort(),
    transitions: listTransitions().slice().sort(),
    renderers: ["dom-preview", "browser-webcodecs", "server-chromium"],
    features: ["keyframes", "groups", "captions", "audio", "effects", "transitions"],
  };
}
