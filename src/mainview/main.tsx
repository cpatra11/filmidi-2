import "./audio-unlock";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Preload Noto Sans font so DomRenderer's initLayers doesn't block on network
const preloadFont = document.createElement("link");
preloadFont.rel = "preload";
preloadFont.as = "font";
preloadFont.crossOrigin = "anonymous";
preloadFont.href = "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap";
document.head.appendChild(preloadFont);

// Also preload the actual font file for faster rendering
const preloadWoff = document.createElement("link");
preloadWoff.rel = "preload";
preloadWoff.as = "font";
preloadWoff.type = "font/woff2";
preloadWoff.crossOrigin = "anonymous";
preloadWoff.href = "https://fonts.gstatic.com/s/notosans/v36/o-0mIhZia9cY9_7CkAujOg.woff2";
document.head.appendChild(preloadWoff);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
