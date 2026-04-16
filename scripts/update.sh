#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "Error: Docker Compose is not available. Install Docker Compose v2 ('docker compose') or v1 ('docker-compose')." >&2
  exit 1
fi

git --no-pager pull --ff-only || true
"${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yml pull || true
"${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yml up -d --build

echo "Clover updated"
