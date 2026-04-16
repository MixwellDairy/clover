# Clover

Clover is a multi-user AI chat app with:
- Persistent chat sessions
- Groq + Ollama model support
- Smart memory extraction/injection
- Admin dashboard (users, conversations, memories, analytics, settings)
- Pastel green modern UI

## Project Structure
- `/frontend` - Next.js + TypeScript web app
- `/backend` - Express + TypeScript API server
- `/docker` - Dockerfiles + Compose stack
- `/scripts` - install, update, cleanup helpers
- `/docs` - setup + memory docs

## Run with Docker (recommended)
```bash
cp .env.example .env
# set GROQ_API_KEY in .env
./scripts/install.sh
```

## Local Development
### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Set frontend API URL:
```bash
export NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

## Environment
See `.env.example` for all Groq, Ollama, PostgreSQL and Redis variables.
