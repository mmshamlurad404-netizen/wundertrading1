#!/bin/bash
# NebulaTrade - start backend + frontend for local preview.
# The frontend dev server (port 5173) is the exposed entry point and reverse
# proxies /api and /ws to the backend on port 3001.

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start backend in the background
echo "Starting backend on port 3001..."
(cd "$ROOT_DIR/backend" && PORT=3001 node src/index.js) &
BACKEND_PID=$!

cleanup() {
  echo "Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start frontend (exposed port)
echo "Starting frontend on port 5173..."
cd "$ROOT_DIR/frontend"
npm run dev
