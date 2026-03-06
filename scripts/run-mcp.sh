#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

export PATH="$HOME/.bun/bin:$PATH"

cd "$PROJECT_DIR"
bun install --silent 2>/dev/null
exec bun run src/index.ts
