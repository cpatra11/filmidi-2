#!/usr/bin/env bun
/**
 * Postinstall patch for @videoflow/renderer-dom DomRenderer.js
 *
 * Patches applied:
 * 1. Web Audio API (non-blocking, no WAV roundtrip) — bypasses WKWebView autoplay
 * 2. cleanupAudio — also stops Web Audio source
 * 3. Drift correction — works with Web Audio timing
 * 4. Skip document.fonts.ready during playback
 * 5. Throttle onFrame to 10fps max — prevents React re-render pile-up
 * 6. Skip loadVideo during playback — prevents React re-render loop killing play
 * 7. Skip loadVideo for same content — prevents infinite rebuild cycle
 * 8. Debounce play() — prevents rapid play/stop cycling
 * 9. Skip ensureLayerFontsLoaded during playback — eliminates 2s render stall
 * 10. Debug logging via fetch to /api/log
 * 11. Slow-render logging (>50ms threshold)
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const domRendererPath = join(
  process.cwd(),
  "node_modules/@videoflow/renderer-dom/dist/DomRenderer.js"
);

if (!existsSync(domRendererPath)) {
  console.log("patch-dom-renderer: not found, skipping");
  process.exit(0);
}

let code = readFileSync(domRendererPath, "utf8");

// Check all patches applied
if (
  code.includes("__vfWebAudio") &&
  code.includes("__vfLastOnFrame") &&
  code.includes("__vfRenderStart") &&
  code.includes("loadVideo() SKIP") &&
  code.includes("__vfLastPlay") &&
  code.includes(".catch(() => {})")
) {
  console.log("patch-dom-renderer: already patched");
  process.exit(0);
}

let patchCount = 0;

// ── Patch 1: Non-blocking Web Audio (no WAV roundtrip) ─────────────────────
const audioBlock = `const audioBuffer = await this.renderAudio();
            if (myToken !== this.playToken) {
                for (const layer of this.layers)
                    layer.exitSmoothPlayback();
                return;
            }
            if (audioBuffer) {
                const wav = audioBufferToWav(audioBuffer);
                const blob = new Blob([wav], { type: 'audio/wav' });
                this.audioUrl = URL.createObjectURL(blob);
                this.audio = new Audio(this.audioUrl);
                this.audio.loop = false;
                this.audio.currentTime = startTimeSec;
                this.audio.play();
            }`;

const webAudioBlock = `this.renderAudio().then(audioBuffer => {
                if (myToken !== this.playToken || !audioBuffer) return;
                try {
                    const actx = (window.__vfAudioCtx && window.__vfAudioCtx.state !== 'closed')
                        ? window.__vfAudioCtx
                        : new AudioContext();
                    if (actx.state === 'suspended') actx.resume();
                    const src = actx.createBufferSource();
                    src.buffer = audioBuffer;
                    src.connect(actx.destination);
                    src.start(0, Math.max(0, startTimeSec));
                    this.__vfWebAudio = { ctx: actx, buffer: audioBuffer, source: src, startTime: actx.currentTime - startTimeSec };
                    this.audio = null;
                    this.audioUrl = null;
                } catch (e) {
                    console.warn('Web Audio setup failed:', e);
                }
            }).catch(() => {});`;

if (code.includes(audioBlock)) {
  code = code.replace(audioBlock, webAudioBlock);
  patchCount++;
}

// ── Patch 2: cleanupAudio — stop Web Audio source ──────────────────────────
const cleanupSearch = `cleanupAudio() {
        this.audio?.pause();
        this.audio = null;
        if (this.audioUrl) {
            URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = null;
        }`;
const cleanupReplace = `cleanupAudio() {
        if (this.__vfWebAudio?.source) { try { this.__vfWebAudio.source.stop(); } catch {} this.__vfWebAudio.source = null; }
        this.__vfWebAudio = null;
        this.audio?.pause();
        this.audio = null;
        if (this.audioUrl) {
            URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = null;
        }`;

if (code.includes(cleanupSearch)) {
  code = code.replace(cleanupSearch, cleanupReplace);
  patchCount++;
}

// ── Patch 3: Drift correction for Web Audio ────────────────────────────────
const driftRegex = /(if \(this\.audio\) \{\s*const audioTime = this\.audio\.currentTime;\s*const syncDiff = currentTimeSec - audioTime;)/;

if (driftRegex.test(code)) {
  code = code.replace(driftRegex, `if (this.__vfWebAudio?.ctx && this.__vfWebAudio?.startTime !== undefined) {
                            const audioTime = this.__vfWebAudio.ctx.currentTime - this.__vfWebAudio.startTime;
                            const syncDiff = currentTimeSec - audioTime;
                        } else if (this.audio) {
                            const audioTime = this.audio.currentTime;
                            const syncDiff = currentTimeSec - audioTime;`);
  patchCount++;
}

// ── Patch 4: Skip document.fonts.ready + ensureLayerFontsLoaded during playback ─
if (code.includes("await this.ensureLayerFontsLoaded();\n            if (!this.playing) await document.fonts.ready;")) {
  code = code.replace(
    "await this.ensureLayerFontsLoaded();\n            if (!this.playing) await document.fonts.ready;",
    "if (!this.playing) {\n                await this.ensureLayerFontsLoaded();\n                await document.fonts.ready;\n            }"
  );
  patchCount++;
} else if (code.includes("await this.ensureLayerFontsLoaded();") && !code.includes("if (!this.playing) {")) {
  code = code.replace(
    "await this.ensureLayerFontsLoaded();\n            await document.fonts.ready;",
    "if (!this.playing) {\n                await this.ensureLayerFontsLoaded();\n                await document.fonts.ready;\n            }"
  );
  patchCount++;
}

// ── Patch 4b: Fire-and-forget font loading (eliminates 2s initLayers stall) ─
if (code.includes("await this.loadFont(defaultFont);")) {
  code = code.replace(
    "await this.loadFont(defaultFont);",
    "this.loadFont(defaultFont).catch(() => {});"
  );
  patchCount++;
}

// ── Patch 5: Throttle onFrame to 10fps max ─────────────────────────────────
const onFrameOrig = `            this.currentFrame = frame;\n            this.onFrame?.(frame);`;
const onFrameThrottled = `            this.currentFrame = frame;\n            const _now = Date.now();\n            if (!this.__vfLastOnFrame || _now - this.__vfLastOnFrame > 100) {\n                this.__vfLastOnFrame = _now;\n                this.onFrame?.(frame);\n            }`;

if (code.includes(onFrameOrig)) {
  code = code.replace(onFrameOrig, onFrameThrottled);
  patchCount++;
}

// ── Patch 6: loadVideo guards ──────────────────────────────────────────────
if (!code.includes("_lvlog = (msg) =>")) {
  code = code.replace(
    "    async loadVideo(videoJSON) {\n        // Serialize",
    "    async loadVideo(videoJSON) {\n        const _lvlog = (msg) => { try { fetch('/api/log', { method: 'POST', body: msg }).catch(() => {}); } catch {} };\n        _lvlog('loadVideo() called while playing=' + this.playing);\n        // Serialize"
  );
  patchCount++;
}

if (!code.includes("loadVideo() SKIP")) {
  code = code.replace(
    "        _lvlog('loadVideo() called while playing=' + this.playing);\n        // Serialize",
    "        _lvlog('loadVideo() called while playing=' + this.playing);\n        if (this.playing) { _lvlog('loadVideo() SKIP — playing'); return; }\n        if (videoJSON === this.videoJSON) { _lvlog('loadVideo() SKIP — same reference'); return; }\n        if (this.videoJSON && videoJSON && videoJSON.fps === this.videoJSON.fps && videoJSON.duration === this.videoJSON.duration && videoJSON.width === this.videoJSON.width && videoJSON.height === this.videoJSON.height && videoJSON.layers?.length === this.videoJSON.layers?.length && JSON.stringify(videoJSON) === JSON.stringify(this.videoJSON)) { _lvlog('loadVideo() SKIP — same content'); return; }\n        // Serialize"
  );
  patchCount++;
}

// ── Patch 7: Debounce play() ───────────────────────────────────────────────
if (!code.includes("__vfLastPlay")) {
  code = code.replace(
    "        if (this.playing)\n            return;\n        // Take a generation token",
    "        if (this.playing)\n            return;\n        if (this.__vfLastPlay && Date.now() - this.__vfLastPlay < 200) return;\n        this.__vfLastPlay = Date.now();\n        // Take a generation token"
  );
  patchCount++;
}

// ── Patch 8: Render timing ─────────────────────────────────────────────────
if (!code.includes("this.__vfRenderStart = Date.now();")) {
  code = code.replace(
    "            this.rendering = true;\n            if (!this.elementsSetup)\n                await this.initLayers();",
    "            this.rendering = true;\n            this.__vfRenderStart = Date.now();\n            if (!this.elementsSetup)\n                await this.initLayers();"
  );
  patchCount++;
}

if (!code.includes("SLOW-RENDER frame=")) {
  code = code.replace(
    "            await this.processEffectLayers(frame);\n            this.currentFrame = frame;",
    "            await this.processEffectLayers(frame);\n            this.currentFrame = frame;\n            { const _rt = Date.now() - this.__vfRenderStart; if (_rt > 50) { try { fetch('/api/log', { method: 'POST', body: 'SLOW-RENDER frame=' + frame + ' total=' + _rt + 'ms layers=' + this.layers.length }).catch(() => {}); } catch {} } }"
  );
  patchCount++;
}

// ── Patch 9: Loop iteration logging ────────────────────────────────────────
if (!code.includes("_loopIter = 0")) {
  code = code.replace(
    "            let lastIssued = -1;\n            // Sliding 1s window",
    "            let lastIssued = -1;\n            let _loopIter = 0;\n            let _lastLog = Date.now();\n            // Sliding 1s window"
  );
  patchCount++;
}

if (!code.includes("_loopIter++")) {
  code = code.replace(
    "                while (this.playing && myToken === this.playToken) {\n                    const elapsed = (Date.now() - startTime) / 1000;",
    "                while (this.playing && myToken === this.playToken) {\n                    _loopIter++;\n                    { const _ln = Date.now(); if (_ln - _lastLog > 500) { try { fetch('/api/log', { method: 'POST', body: 'LOOP iter=' + _loopIter + ' rendering=' + this.rendering + ' pending=' + this.pendingFrame }).catch(() => {}); } catch {} _lastLog = _ln; } }\n                    const elapsed = (Date.now() - startTime) / 1000;"
  );
  patchCount++;
}

if (patchCount > 0) {
  writeFileSync(domRendererPath, code, "utf8");
  // Clear Vite dep cache
  const viteDepsDir = join(process.cwd(), "node_modules/.vite/deps");
  if (existsSync(viteDepsDir)) {
    rmSync(viteDepsDir, { recursive: true, force: true });
  }
  console.log(`patch-dom-renderer: applied ${patchCount} patches (Vite cache cleared)`);
} else {
  console.log("patch-dom-renderer: no changes needed (targets not found)");
}
