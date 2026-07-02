#!/usr/bin/env bash
set -e

REPO="https://github.com/dvirchakim/DvirRfqSystem.git"
DIR="DvirRfqSystem/dashboard-app"
PORT="${PORT:-8080}"

echo ""
echo "  🚀 RFQ Dashboard — deploying..."
echo ""

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "  ❌ Docker not found. Install Docker Desktop from https://docker.com and try again."
  exit 1
fi

# Clone or update
if [ -d "DvirRfqSystem" ]; then
  echo "  ↻  Updating existing repo..."
  git -C DvirRfqSystem pull --ff-only
else
  echo "  ⬇  Cloning repo..."
  git clone "$REPO"
fi

cd "$DIR"

# Build and start
echo "  🔨 Building image..."
PORT=$PORT docker compose build --no-cache -q

echo "  ▶  Starting container..."
PORT=$PORT docker compose up -d

echo ""
echo "  ✅ Done!  →  http://localhost:${PORT}"
echo ""
