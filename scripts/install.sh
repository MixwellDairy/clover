#!/usr/bin/env bash
# Clover installer – robust, self-healing, self-documenting.
set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()     { echo -e "${RED}[FAIL]${NC}  $*" >&2; }
fatal()   { err "$*"; exit 1; }

# Portable in-place sed (macOS needs an explicit backup extension)
sed_i() { if [[ "$(uname)" == "Darwin" ]]; then sed -i '' "$@"; else sed -i "$@"; fi; }

# ─── Resolve repo root ────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${BOLD}🍀  Clover Installer${NC}"
echo "────────────────────────────────────"

# ─── 1. Detect Docker and compose command ────────────────────────────────────
info "Checking Docker…"

command -v docker &>/dev/null \
  || fatal "Docker is not installed.\n       → Install it from https://docs.docker.com/get-docker/"

docker info &>/dev/null 2>&1 \
  || fatal "Docker daemon is not running.\n       → Start Docker Desktop, or run: sudo systemctl start docker"

if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
  success "Docker compose plugin detected  (docker compose)"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
  success "Standalone docker-compose detected  (docker-compose)"
else
  fatal "'docker compose' or 'docker-compose' is required.\n       → Install: sudo apt install docker-compose-plugin"
fi

# ─── 2. Check required ports are free ─────────────────────────────────────────
info "Checking required ports…"

# Returns 0 (true) if the port is already in use on localhost
port_in_use() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -ltn 2>/dev/null | grep -qE "[[:space:]]0\.0\.0\.0:${port}[[:space:]]|[[:space:]]:::${port}[[:space:]]|[[:space:]]\*:${port}[[:space:]]"
  elif command -v lsof &>/dev/null; then
    lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null
  else
    # Fallback: attempt a TCP connection (may cause false negatives if firewalled)
    (echo >/dev/tcp/127.0.0.1/"$port") &>/dev/null
  fi
}

declare -A PORT_HINTS=(
  [3000]="Frontend – stop anything on port 3000 (check: lsof -i :3000)"
  [4000]="Backend  – stop anything on port 4000 (check: lsof -i :4000)"
  [5432]="Postgres – sudo systemctl stop postgresql"
  [6379]="Redis    – sudo systemctl stop redis"
  [8080]="Proxy    – stop anything on port 8080 (check: lsof -i :8080)"
  [11434]="Ollama   – sudo systemctl stop ollama"
)

PORT_FAIL=0
for PORT in 3000 4000 5432 6379 8080 11434; do
  if port_in_use "$PORT"; then
    err "Port ${PORT} is already in use.  → ${PORT_HINTS[$PORT]}"
    PORT_FAIL=1
  else
    success "Port ${PORT} is free"
  fi
done
[[ "$PORT_FAIL" -eq 0 ]] \
  || fatal "One or more required ports are occupied.  Free them and re-run install.sh."

# ─── 3. Set up .env and validate GROQ_API_KEY ─────────────────────────────────
info "Checking .env…"

if [[ ! -f .env ]]; then
  cp .env.example .env
  success "Created .env from .env.example"
fi

# Read key (strips surrounding quotes and whitespace)
GROQ_KEY="$(grep -E '^GROQ_API_KEY=' .env | head -1 | cut -d'=' -f2- \
            | tr -d "\"'" | xargs 2>/dev/null || true)"

if [[ -z "$GROQ_KEY" ]]; then
  warn "GROQ_API_KEY is not set in .env"
  echo -e "       Get a free key at ${BLUE}https://console.groq.com${NC}"
  echo ""
  read -r -p "  ► Enter your Groq API key now (or press Enter to skip): " INPUT_KEY || true
  if [[ -n "$INPUT_KEY" ]]; then
    sed_i "s|^GROQ_API_KEY=.*|GROQ_API_KEY=${INPUT_KEY}|" .env
    GROQ_KEY="$INPUT_KEY"
    success "GROQ_API_KEY saved to .env"
  else
    warn "Skipping Groq key – AI chat features will be unavailable until a key is added."
    warn "  → After install: Admin Panel → AI Access and Model Settings → Groq API Keys"
  fi
else
  success "GROQ_API_KEY is set in .env"
fi

# ─── 4. Build and start all services ─────────────────────────────────────────
info "Building and starting Clover (this can take a few minutes on first run)…"
$DC -f docker/docker-compose.yml up -d --build

# ─── 5. Wait for each service to become healthy ────────────────────────────────
# Polls docker inspect health status; falls back to direct HTTP probe.
wait_healthy() {
  local service="$1"
  local probe_url="${2:-}"
  local label="${3:-$service}"
  local max_wait=180   # seconds
  local interval=5
  local elapsed=0

  info "Waiting for ${label} to be healthy…"
  while (( elapsed < max_wait )); do
    # Primary: check Docker-reported health state
    local cid status
    cid="$($DC -f docker/docker-compose.yml ps -q "${service}" 2>/dev/null | head -1 || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect \
                  --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
                  "$cid" 2>/dev/null || echo "unknown")"
      if [[ "$status" == "healthy" ]]; then
        success "${label} is healthy"
        return 0
      fi
    fi

    # Secondary fallback: direct HTTP probe (e.g. for services without healthcheck)
    if [[ -n "$probe_url" ]] && curl -sf --max-time 3 "$probe_url" &>/dev/null; then
      success "${label} responded on ${probe_url}"
      return 0
    fi

    sleep "$interval"
    (( elapsed += interval ))
  done

  err "${label} did not become healthy within ${max_wait}s."
  err "  → Logs: $DC -f docker/docker-compose.yml logs ${service}"
  return 1
}

HEALTH_FAIL=0
wait_healthy db       ""                             "PostgreSQL"         || HEALTH_FAIL=1
wait_healthy redis    ""                             "Redis"              || HEALTH_FAIL=1
wait_healthy backend  "http://localhost:4000/api/health" "Backend (API)"  || HEALTH_FAIL=1
wait_healthy frontend "http://localhost:3000"        "Frontend"           || HEALTH_FAIL=1
wait_healthy proxy    "http://localhost:8080"        "Reverse proxy"      || HEALTH_FAIL=1

if [[ "$HEALTH_FAIL" -ne 0 ]]; then
  fatal "One or more services failed to become healthy.\n       → Run: $DC -f docker/docker-compose.yml logs"
fi

# ─── 6. Seed GROQ_API_KEY into the web UI settings ────────────────────────────
if [[ -n "$GROQ_KEY" ]]; then
  info "Seeding GROQ_API_KEY into the web UI (Admin → Settings)…"

  # Authenticate as the default admin to obtain a JWT
  LOGIN_RESP="$(curl -sf --max-time 10 \
    -X POST http://localhost:4000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@clover.local","password":"admin123"}' || true)"

  # Portable token extraction (no jq required)
  ADMIN_TOKEN="$(echo "$LOGIN_RESP" | tr -d '\n' \
                 | sed 's/.*"token":"\([^"]*\)".*/\1/' || true)"

  if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == "$LOGIN_RESP" ]]; then
    warn "Could not authenticate as admin to seed the API key automatically."
    warn "  → After install: Admin Panel → AI Access and Model Settings → Groq API Keys"
  else
    # Helper: PUT a single setting via the admin API
    put_setting() {
      local key="$1" value="$2"
      curl -sf --max-time 10 \
        -X PUT http://localhost:4000/api/admin/settings \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -d "{\"key\":\"${key}\",\"value\":${value}}" &>/dev/null || true
    }

    # Legacy single-key field (displayed in existing settings table)
    put_setting "groq_api_key"       "\"${GROQ_KEY}\""

    # Multi-key JSON array (used by the Groq API Keys panel)
    put_setting "groq_api_keys"      "[\"${GROQ_KEY}\"]"

    # Active key index
    put_setting "groq_api_key_index" "\"0\""

    success "GROQ_API_KEY saved to database settings (visible in Admin Panel)"
  fi
fi

# ─── 7. Final connectivity check ─────────────────────────────────────────────
info "Testing connectivity to http://localhost:8080…"
if curl -sf --max-time 10 "http://localhost:8080" &>/dev/null; then
  success "http://localhost:8080 is reachable"
else
  err "http://localhost:8080 did not respond."
  err "  → Check proxy logs: $DC -f docker/docker-compose.yml logs proxy"
  fatal "Installation complete but the app is unreachable on port 8080."
fi

# ─── Success summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓  Clover is installed and running!${NC}"
echo "────────────────────────────────────"
echo -e "  App (unified):   ${BOLD}http://localhost:8080${NC}"
echo -e "  Frontend direct: http://localhost:3000"
echo -e "  Backend API:     http://localhost:4000"
echo ""
echo -e "  ${BOLD}Default admin login:${NC}"
echo    "    Email:    admin@clover.local"
echo    "    Password: admin123"
echo ""
if [[ -n "$GROQ_KEY" ]]; then
  echo -e "  ${GREEN}Groq API key configured in the web UI.${NC}"
else
  echo -e "  ${YELLOW}No Groq key set.  Add one at:${NC}"
  echo    "    http://localhost:8080/admin  →  AI Access and Model Settings"
fi
echo ""
echo    "  To stop:   $DC -f docker/docker-compose.yml down"
echo    "  To update: ./scripts/update.sh"
echo    "  To remove: ./scripts/cleanup.sh"
echo ""

