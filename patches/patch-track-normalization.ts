#!/usr/bin/env bun
/**
 * Keep explicit timeline track assignments stable. VideoFlow's default
 * normalizer repacks every layer after every commit, which makes empty rows
 * and intentional cross-track placement impossible to preserve.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const storePath = join(
  process.cwd(),
  "node_modules/@videoflow/react-video-editor/dist/store.js",
);

if (!existsSync(storePath)) {
  console.log("patch-track-normalization: not found, skipping");
  process.exit(0);
}

let code = readFileSync(storePath, "utf8");
if (code.includes("__filmidiStableTracks")) {
  console.log("patch-track-normalization: already patched");
  process.exit(0);
}

const rootPattern = "const n=v(a.layers);for(let t=0;t<a.layers.length;t++)a.layers[t].track=n[t];";
const groupPattern = "const i=v(e);for(let o=0;o<e.length;o++)e[o].track=i[o]";

if (!code.includes(rootPattern) || !code.includes(groupPattern)) {
  console.log("patch-track-normalization: target layout changed, skipping");
  process.exit(0);
}

code = code.replace(
  rootPattern,
  '/*__filmidiStableTracks*/for(let t=0;t<a.layers.length;t++){const r=a.layers[t].track;a.layers[t].track=typeof r==="number"&&Number.isFinite(r)?Math.max(0,Math.floor(r)):0}',
);
code = code.replace(
  groupPattern,
  'for(let o=0;o<e.length;o++){const r=e[o].track;e[o].track=typeof r==="number"&&Number.isFinite(r)?Math.max(0,Math.floor(r)):0}',
);

writeFileSync(storePath, code, "utf8");
const viteDepsDir = join(process.cwd(), "node_modules/.vite/deps");
if (existsSync(viteDepsDir)) rmSync(viteDepsDir, { recursive: true, force: true });
console.log("patch-track-normalization: preserved explicit track assignments");
