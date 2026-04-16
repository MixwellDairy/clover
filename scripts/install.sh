#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

docker compose -f docker/docker-compose.yml up -d --build

echo "Clover installed. Frontend: http://localhost:3000 Backend: http://localhost:4000"
