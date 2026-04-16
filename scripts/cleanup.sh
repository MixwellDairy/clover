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

$DC -f docker/docker-compose.yml down -v --remove-orphans

echo "Clover removed (including Docker volumes)"

