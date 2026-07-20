#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[sidecar] macOS-only helper skipped on this platform"
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/native/sidecar"
OUTPUT_DIR="$ROOT_DIR/native/sidecar"
OUTPUT_BIN="$OUTPUT_DIR/FilmidiSidecar"
CACHE_ROOT="$ROOT_DIR/.cache/sidecar"

mkdir -p "$OUTPUT_DIR"
mkdir -p "$CACHE_ROOT/home" "$CACHE_ROOT/clang"
rm -f "$OUTPUT_BIN"

export HOME="$CACHE_ROOT/home"
export CLANG_MODULE_CACHE_PATH="$CACHE_ROOT/clang"

swift build --package-path "$PACKAGE_DIR" -c release
cp "$PACKAGE_DIR/.build/release/FilmidiSidecar" "$OUTPUT_BIN"
chmod +x "$OUTPUT_BIN"

echo "[sidecar] built $OUTPUT_BIN"
