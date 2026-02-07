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
