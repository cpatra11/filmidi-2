#!/usr/bin/env bun
/**
 * Lightweight preload that forwards window.console.* to the Bun process stdout.
 * This lets us see webview errors in the terminal without CDP.
 */
const preloadCode = `
(function() {
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  ['log','warn','error','info','debug'].forEach(level => {
    console[level] = function(...args) {
      orig[level].apply(console, args);
      try {
        window.__electrobunEventBridge?.postMessage(JSON.stringify({
          id: 'console-forward',
          type: 'message',
          payload: { level, args: args.map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ') }
        }));
      } catch {}
    };
  });
  window.addEventListener('error', (e) => {
    try {
      window.__electrobunEventBridge?.postMessage(JSON.stringify({
        id: 'console-forward',
        type: 'message',
        payload: { level: 'error', args: 'Uncaught: ' + (e.message || e.filename + ':' + e.lineno) }
      }));
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      window.__electrobunEventBridge?.postMessage(JSON.stringify({
        id: 'console-forward',
        type: 'message',
        payload: { level: 'error', args: 'UnhandledPromise: ' + (e.reason?.message || String(e.reason)) }
      }));
    } catch {}
  });
})();
`;

import { writeFileSync } from "fs";
const outPath = import.meta.dir + "/console-bridge.js";
writeFileSync(outPath, preloadCode, "utf8");
console.log("Wrote console preload to", outPath);
