#!/usr/bin/env bash
# Run Vibe Voice using the local virtualenv
set -e
cd "$(dirname "$0")"
.venv/bin/python3 main.py "$@"
