#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "Error: Docker Compose is not available. Install Docker Compose v2 ('docker compose') or v1 ('docker-compose')." >&2
  exit 1
fi

"${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yml up -d --build

echo "Clover installed. Frontend: http://localhost:3000 Backend: http://localhost:4000"
