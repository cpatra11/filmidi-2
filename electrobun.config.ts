import type { ElectrobunConfig } from "electrobun";

const isMac = process.platform === "darwin";
const buildCopy: Record<string, string> = {
  "dist/index.html": "views/mainview/index.html",
  "dist/assets": "views/mainview/assets",
};

if (isMac) {
  buildCopy["native/sidecar/FilmidiSidecar"] = "native/sidecar/FilmidiSidecar";
}

export default {
  app: {
    name: "Filmidi",
    identifier: "com.filmidi.editor",
    version: "0.0.1",
  },
  build: {
    copy: buildCopy,
    watchIgnore: ["dist/**"],
    mac: {
      // Use a bundled Chromium runtime for media compatibility instead of
      // inheriting the host macOS WebKit version.
      bundleCEF: true,
      icons: "assets/icons/Filmidi.iconset",
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
