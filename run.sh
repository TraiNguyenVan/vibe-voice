#!/usr/bin/env bash
# Run Vibe Voice (Tauri desktop widget)
set -e
cd "$(dirname "$0")"
pnpm tauri dev
