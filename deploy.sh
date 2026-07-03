#!/usr/bin/env bash
set -e

REPO="https://github.com/dvirchakim/DvirRfqSystem.git"
DIR="DvirRfqSystem"
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
if [ -d "$DIR" ]; then
  echo "  ↻  Updating existing repo..."
  git -C "$DIR" pull --ff-only
else
  echo "  ⬇  Cloning repo..."
  git clone "$REPO"
fi

cd "$DIR"

# Generate a .env with fresh secrets on first run (never overwrite an existing one).
if [ ! -f .env ]; then
  echo "  🔐 Generating .env with fresh secrets..."
  gen() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  API_TOKEN="$(gen)"
  cat > .env <<ENV
POSTGRES_PASSWORD=$(gen)
AGENT_DB_PASSWORD=$(gen)
BACKEND_API_TOKEN=$API_TOKEN
ALLOW_UNAUTHENTICATED=false
# Optional: set your OpenRouter key here, or leave blank and paste it in Settings -> AI Agent.
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-3-haiku
PORT=$PORT
ENV
  echo "  🔐 Generated .env — the AI Agent authenticates to the backend automatically, nothing to paste anywhere."
fi

# Build and start the full stack (dashboard + AI agent + database) from the repo root.
echo "  🔨 Building images..."
docker compose build --no-cache -q

echo "  ▶  Starting stack..."
docker compose up -d

echo ""
echo "  ✅ Done!  →  http://localhost:${PORT}"
echo ""
