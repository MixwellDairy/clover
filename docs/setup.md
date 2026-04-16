# Clover Setup Guide

## Requirements
- Docker + Docker Compose
- Linux or macOS

## Quick Start
1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Set your Groq key in `.env` (`GROQ_API_KEY=...`).
3. Install/start:
   ```bash
   ./scripts/install.sh
   ```
4. Open:
   - Frontend: http://localhost:3000
   - Backend health: http://localhost:4000/api/health

Default admin:
- `admin@clover.local`
- `admin123`

## Update
```bash
./scripts/update.sh
```

## Cleanup
```bash
./scripts/cleanup.sh
```
