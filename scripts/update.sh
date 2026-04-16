#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Detect compose command
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  echo "ERROR: docker compose or docker-compose is required." >&2
  exit 1
fi

git --no-pager pull --ff-only || true
$DC -f docker/docker-compose.yml pull || true
$DC -f docker/docker-compose.yml up -d --build

echo "Clover updated"

