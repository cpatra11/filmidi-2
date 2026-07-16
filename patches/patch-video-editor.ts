#!/usr/bin/env bun
/**
 * Postinstall patch for @videoflow/react-video-editor VideoEditor.js
 * 
 * Fixes the hardcoded 10-second sourceDuration for video/audio files
 * by probing actual media duration via a temporary <video> element.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const editorPath = join(
  process.cwd(),
  "node_modules/@videoflow/react-video-editor/dist/VideoEditor.js"
);

if (!existsSync(editorPath)) {
  console.log("patch-video-editor: not found, skipping");
  process.exit(0);
}

let code = readFileSync(editorPath, "utf8");

if (code.includes("__vfProbeDuration")) {
  console.log("patch-video-editor: already patched");
  process.exit(0);
}

let patchCount = 0;

// Replace hardcoded duration with media probing
// Original: x=i==="image"?5:10
// The variable `f` is the uploaded file URL, `i` is the layer type ("video"/"image"/"audio")
if (code.includes('i==="image"?5:10')) {
  code = code.replace(
    'i==="image"?5:10',
    'i==="image"?5:(await __vfProbeDuration(f))'
  );
  patchCount++;
}

// Inject probe function after the imports (before the first function declaration)
if (patchCount > 0 && !code.includes('async function __vfProbeDuration')) {
  // Find the component function to inject before it
  const funcIdx = code.indexOf('function Dt(');
  if (funcIdx > 0) {
    const probeFn = `async function __vfProbeDuration(src){if(!src)return 10;try{return await new Promise(r=>{const v=document.createElement("video");v.preload="metadata";let done=false;const done2=(d)=>{if(!done){done=true;r(d>0?d:10)}};v.onloadedmetadata=()=>done2(v.duration);v.onerror=()=>done2(0);v.src=src;setTimeout(()=>done2(0),5000);if(v.readyState>=1)done2(v.duration)})}catch{return 10}}\n`;
    code = code.slice(0, funcIdx) + probeFn + code.slice(funcIdx);
    patchCount++;
  }
}

if (patchCount > 0) {
  writeFileSync(editorPath, code, "utf8");
  // Clear Vite dep cache
  const viteDepsDir = join(process.cwd(), "node_modules/.vite/deps");
  if (existsSync(viteDepsDir)) {
    rmSync(viteDepsDir, { recursive: true, force: true });
  }
  console.log(`patch-video-editor: applied ${patchCount} patches (Vite cache cleared)`);
} else {
  console.log("patch-video-editor: no changes needed (targets not found)");
}
