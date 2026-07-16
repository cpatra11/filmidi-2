#!/usr/bin/env bun
/**
 * Postinstall patch for @videoflow/renderer-browser RuntimeVideoLayer.js
 *
 * Patches applied:
 * 1. Pre-seek + play in enterSmoothPlayback — eliminates 2s first-frame delay
 * 2. Replace requestVideoFrameCallback with seeked event — fixes WKWebView seek
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const videoLayerPath = join(
  process.cwd(),
  "node_modules/@videoflow/renderer-browser/dist/layers/RuntimeVideoLayer.js"
);

if (!existsSync(videoLayerPath)) {
  console.log("patch-video-layer: not found, skipping");
  process.exit(0);
}

let code = readFileSync(videoLayerPath, "utf8");

// Check if already patched
if (
  code.includes("_vfFirstSmoothFrame") &&
  code.includes("seeked")
) {
  console.log("patch-video-layer: already patched");
  process.exit(0);
}

let patchCount = 0;

// ── Patch 1: Pre-seek + play in enterSmoothPlayback ────────────────────────
const enterOrig = `    enterSmoothPlayback() {
        this.smoothMode = true;
        // Park vidB; only vidA participates in smooth playback.
        if (this.vidB)
            this.vidB.pause();
    }`;

const enterPatched = `    enterSmoothPlayback() {
        this.smoothMode = true;
        this._vfFirstSmoothFrame = true;
        // Park vidB; only vidA participates in smooth playback.
        if (this.vidB)
            this.vidB.pause();
        // Pre-seek vidA to current frame and start playing immediately.
        // This eliminates the 2s first-frame delay from requestVideoFrameCallback.
        if (this.vidA && this.vidA.paused) {
            const targetTime = this.sourceTimeAtFrame(this.currentFrame ?? 0);
            this.vidA.currentTime = targetTime;
            this.vidATargetTime = targetTime;
            this.vidA.playbackRate = this.speed > 0 ? this.speed : 1;
            this.vidA.play().catch(() => {});
        }
    }`;

if (code.includes(enterOrig)) {
  code = code.replace(enterOrig, enterPatched);
  patchCount++;
}

// ── Patch 2: Replace seekVideo — use seeked event instead of requestVideoFrameCallback ──
const seekOrig = `    seekVideo(vid, targetTime) {
        vid.pause();
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(), 2000);
            vid.requestVideoFrameCallback(() => {
                clearTimeout(timeout);
                resolve();
            });
            vid.currentTime = targetTime;
        });
    }`;

const seekPatched = `    seekVideo(vid, targetTime) {
        vid.pause();
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(), 1000);
            const onSeeked = () => {
                clearTimeout(timeout);
                vid.removeEventListener('seeked', onSeeked);
                resolve();
            };
            vid.addEventListener('seeked', onSeeked);
            vid.currentTime = targetTime;
        });
    }`;

if (code.includes(seekOrig)) {
  code = code.replace(seekOrig, seekPatched);
  patchCount++;
}

// ── Patch 3: renderFrameSmooth — skip blocking seekVideo on first smooth frame ──
const smoothOrig = `    async renderFrameSmooth(frame) {
        const vid = this.vidA;
        const targetTime = this.sourceTimeAtFrame(frame);
        const speed = this.speed;
        if (speed <= 0) {
            // playbackRate must be positive — drop to the seek path for this
            // frame. The smoothMode flag stays on so layers further forward
            // in playback resume smooth as soon as conditions allow.
            await this.renderFrameSeek(frame);
            return;
        }
        // First frame in range, or vidA was paused (e.g. layer just entered
        // its window): seed playback at the right source time.
        if (vid.paused) {
            vid.playbackRate = speed;
            this.vidATargetTime = targetTime;
            this.vidAReady = this.seekVideo(vid, targetTime);
            await this.vidAReady;
            if (!this.smoothMode)
                return; // bailed mid-await
            // \`play()\` returns a promise that rejects if the user-gesture
            // requirement isn't met. Caller (DomRenderer.play) should always
            // be invoked from a user gesture, so this normally resolves; we
            // swallow the rejection to keep the render loop alive.
            vid.play().catch(() => { });
        }`;

const smoothPatched = `    async renderFrameSmooth(frame) {
        const _sfm0 = Date.now();
        const vid = this.vidA;
        const targetTime = this.sourceTimeAtFrame(frame);
        const speed = this.speed;
        if (speed <= 0) {
            await this.renderFrameSeek(frame);
            return;
        }
        if (vid.paused) {
            vid.playbackRate = speed;
            this.vidATargetTime = targetTime;
            // First smooth frame: start seek in background, don't block.
            // Canvas already has the correct frame from loadVideo/previous render.
            if (this._vfFirstSmoothFrame) {
                this._vfFirstSmoothFrame = false;
                this.vidAReady = this.seekVideo(vid, targetTime);
                this.vidAReady.then(() => { vid.play().catch(() => {}); });
                return;
            }
            this.vidAReady = this.seekVideo(vid, targetTime);
            await this.vidAReady;
            if (!this.smoothMode)
                return;
            vid.play().catch(() => { });
        }`;

if (code.includes(smoothOrig)) {
  code = code.replace(smoothOrig, smoothPatched);
  patchCount++;
}

if (patchCount > 0) {
  writeFileSync(videoLayerPath, code, "utf8");
  // Clear Vite dep cache
  const viteDepsDir = join(process.cwd(), "node_modules/.vite/deps");
  if (existsSync(viteDepsDir)) {
    rmSync(viteDepsDir, { recursive: true, force: true });
  }
  console.log(`patch-video-layer: applied ${patchCount} patches (Vite cache cleared)`);
} else {
  console.log("patch-video-layer: no changes needed (targets not found)");
}
