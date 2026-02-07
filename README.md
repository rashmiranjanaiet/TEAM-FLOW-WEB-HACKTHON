# NASA Project Environment

## 1) Prepare env file

```powershell
Copy-Item .env.example .env
```

Edit `.env` if needed, especially `NASA_API_KEY`.

## 2) Run with Docker Compose

```powershell
docker compose up --build
```

This setup now uses multi-stage Docker builds:
- Frontend: `node` build stage -> `nginx` runtime stage
- Backend: Python dependency builder stage -> slim runtime stage

Services:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Backend health: `http://localhost:8000/health`
- Postgres: `localhost:5432`

## 3) Optional local backend-only run (without Docker)

```powershell
python -m venv backend/.venv
.\\backend\\.venv\\Scripts\\Activate.ps1
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload
```

## 4) Postman collection (complete)

Import these files into Postman:
- `postman/NASA-Cosmic-Watch.postman_collection.json`
- `postman/NASA-Cosmic-Watch.local.postman_environment.json`

Included coverage:
- Environment variables: `baseUrl`, `startDate`, `endDate`, `invalidEndDate`
- Pre-request script auto-generates date variables
- Test cases for:
  - `GET /health`
  - `GET /`
  - `GET /api/neo/feed` (valid range)
  - `GET /api/neo/feed` (`end_date` before `start_date` -> 400)
  - `GET /api/neo/feed` (range > 7 days -> 400)
  - `GET /api/neo/today-summary`

## 5) Real-time community chat (WebSocket)

Bonus feature is implemented with FastAPI WebSockets:
- Backend endpoint: `ws://localhost:8000/ws/chat`
- Frontend includes a live chat panel with:
  - auto-connect and auto-reconnect
  - online user count
  - username updates
  - broadcast messages to all connected clients
