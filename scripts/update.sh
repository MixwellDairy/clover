#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

git --no-pager pull --ff-only || true
docker compose -f docker/docker-compose.yml pull || true
docker compose -f docker/docker-compose.yml up -d --build

echo "Clover updated"
