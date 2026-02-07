import json
from datetime import date, datetime, timezone

import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import create_access_token, decode_token, hash_password, verify_password
from app.db import get_active_db_url, get_db, init_db
from app.models import User, WatchlistItem
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut, WatchItemOut, WatchItemUpsert
from app.services.nasa_client import fetch_feed_range, fetch_lookup
from app.services.neo_processing import (
    build_feed_response,
    build_lookup_response,
    normalize_feed_payload,
    normalize_lookup_payload,
)

app = FastAPI(title='Cosmic Watch API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

security = HTTPBearer(auto_error=False)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_date_range(start_date: date | None, end_date: date | None) -> tuple[date, date]:
    resolved_start = start_date or date.today()
    resolved_end = end_date or resolved_start

    if resolved_end < resolved_start:
        raise HTTPException(status_code=400, detail={'error': 'INVALID_DATE_RANGE', 'message': 'end_date cannot be before start_date'})
    if (resolved_end - resolved_start).days > 365:
        raise HTTPException(status_code=400, detail={'error': 'INVALID_DATE_RANGE', 'message': 'date range cannot exceed 365 days'})

    return resolved_start, resolved_end


def _user_out(user: User) -> UserOut:
    return UserOut(id=user.id, username=user.username, email=user.email, created_at=user.created_at)


def _watch_out(item: WatchlistItem) -> WatchItemOut:
    return WatchItemOut(
        asteroid_id=item.asteroid_id,
        asteroid_name=item.asteroid_name,
        risk_category=item.risk_category,
        risk_score=item.risk_score,
        close_approach_date=item.close_approach_date,
        created_at=item.created_at,
    )


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail={'error': 'AUTH_REQUIRED', 'message': 'Missing bearer token'})
    token = creds.credentials
    try:
        payload = decode_token(token)
        user_id = int(payload.get('sub'))
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail={'error': 'INVALID_TOKEN', 'message': 'Token is invalid or expired'})

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail={'error': 'INVALID_TOKEN', 'message': 'User not found'})
    return user


@app.on_event('startup')
def startup() -> None:
    init_db()


@app.get('/')
def root() -> dict:
    return {'message': 'Cosmic Watch API is running', 'db': get_active_db_url()}


@app.get('/favicon.ico', include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get('/health')
def health() -> dict:
    return {'status': 'ok', 'db': get_active_db_url()}


@app.post('/auth/register', response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if '@' not in payload.email:
        raise HTTPException(status_code=400, detail={'error': 'INVALID_EMAIL', 'message': 'Email format is invalid'})

    existing = db.query(User).filter((User.username == payload.username) | (User.email == payload.email)).first()
    if existing:
        raise HTTPException(status_code=409, detail={'error': 'USER_EXISTS', 'message': 'Username or email already exists'})

    user = User(username=payload.username, email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={'error': 'USER_EXISTS', 'message': 'Username or email already exists'})
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail={'error': 'DB_ERROR', 'message': 'Database unavailable'})

    db.refresh(user)
    token = create_access_token(user.id, user.username)
    return TokenResponse(access_token=token, token_type='bearer', user=_user_out(user))


@app.post('/auth/login', response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail={'error': 'INVALID_CREDENTIALS', 'message': 'Username or password is incorrect'})

    token = create_access_token(user.id, user.username)
    return TokenResponse(access_token=token, token_type='bearer', user=_user_out(user))


@app.get('/auth/me', response_model=UserOut)
def auth_me(user: User = Depends(get_current_user)) -> UserOut:
    return _user_out(user)


@app.get('/watchlist')
def get_watchlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == user.id)
        .order_by(WatchlistItem.created_at.desc())
        .all()
    )
    return {'items': [_watch_out(item).model_dump() for item in items]}


@app.post('/watchlist')
def upsert_watchlist(
    payload: WatchItemUpsert,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    item = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == user.id, WatchlistItem.asteroid_id == payload.asteroid_id)
        .first()
    )
    if item:
        item.asteroid_name = payload.asteroid_name
        item.risk_category = payload.risk_category
        item.risk_score = payload.risk_score
        item.close_approach_date = payload.close_approach_date
    else:
        item = WatchlistItem(
            user_id=user.id,
            asteroid_id=payload.asteroid_id,
            asteroid_name=payload.asteroid_name,
            risk_category=payload.risk_category,
            risk_score=payload.risk_score,
            close_approach_date=payload.close_approach_date,
        )
        db.add(item)

    try:
        db.commit()
        db.refresh(item)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail={'error': 'DB_ERROR', 'message': 'Database unavailable'})

    return {'item': _watch_out(item).model_dump()}


@app.delete('/watchlist/{asteroid_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist_item(
    asteroid_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    item = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == user.id, WatchlistItem.asteroid_id == asteroid_id)
        .first()
    )
    if not item:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    db.delete(item)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail={'error': 'DB_ERROR', 'message': 'Database unavailable'})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get('/feed')
def feed(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
) -> dict:
    resolved_start, resolved_end = _resolve_date_range(start_date, end_date)
    raw_payload = fetch_feed_range(resolved_start, resolved_end)
    items = normalize_feed_payload(raw_payload)
    return build_feed_response(resolved_start, resolved_end, items)


@app.get('/lookup/{asteroid_id}')
def lookup(asteroid_id: str) -> dict:
    raw_payload = fetch_lookup(asteroid_id)
    normalized = normalize_lookup_payload(raw_payload)
    return build_lookup_response(asteroid_id, normalized)


@app.get('/api/neo/feed')
def get_neo_feed(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
) -> dict:
    return feed(start_date, end_date)


@app.get('/api/neo/raw')
def get_neo_raw(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
) -> dict:
    resolved_start, resolved_end = _resolve_date_range(start_date, end_date)
    return fetch_feed_range(resolved_start, resolved_end)


@app.get('/api/neo/today-summary')
def get_today_summary() -> dict:
    payload = feed(date.today(), date.today())
    items = payload.get('items', [])
    high = sum(1 for item in items if item.get('risk_category') == 'High')
    medium = sum(1 for item in items if item.get('risk_category') == 'Medium')
    low = sum(1 for item in items if item.get('risk_category') == 'Low')
    return {
        'date': date.today().isoformat(),
        'total': len(items),
        'high_risk': high,
        'medium_risk': medium,
        'low_risk': low,
    }


class ChatManager:
    def __init__(self) -> None:
        self._clients: dict[WebSocket, str] = {}

    @property
    def active_count(self) -> int:
        return len(self._clients)

    def username_for(self, websocket: WebSocket) -> str:
        return self._clients.get(websocket, 'Guest')

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        guest_name = f'Guest-{str(id(websocket))[-4:]}'
        self._clients[websocket] = guest_name
        await self.send_personal(
            websocket,
            {'type': 'system', 'message': 'Connected to Cosmic Watch live chat.', 'timestamp': _utc_now(), 'active_users': self.active_count},
        )
        await self.broadcast(
            {'type': 'system', 'message': f'{guest_name} joined chat.', 'timestamp': _utc_now(), 'active_users': self.active_count}
        )

    async def disconnect(self, websocket: WebSocket) -> None:
        username = self._clients.pop(websocket, None)
        if username:
            await self.broadcast({'type': 'system', 'message': f'{username} left chat.', 'timestamp': _utc_now(), 'active_users': self.active_count})

    async def rename(self, websocket: WebSocket, next_name: str) -> None:
        prev_name = self.username_for(websocket)
        candidate = (next_name or '').strip()[:24]
        if not candidate:
            await self.send_personal(websocket, {'type': 'error', 'message': 'Display name cannot be empty.', 'timestamp': _utc_now()})
            return
        self._clients[websocket] = candidate
        if candidate != prev_name:
            await self.broadcast({'type': 'system', 'message': f'{prev_name} is now {candidate}.', 'timestamp': _utc_now(), 'active_users': self.active_count})

    async def message(self, websocket: WebSocket, text: str) -> None:
        body = (text or '').strip()[:500]
        if not body:
            return
        await self.broadcast({'type': 'chat', 'user': self.username_for(websocket), 'message': body, 'timestamp': _utc_now(), 'active_users': self.active_count})

    async def send_personal(self, websocket: WebSocket, payload: dict) -> None:
        try:
            await websocket.send_json(payload)
        except Exception:
            self._clients.pop(websocket, None)

    async def broadcast(self, payload: dict) -> None:
        stale: list[WebSocket] = []
        for client in self._clients:
            try:
                await client.send_json(payload)
            except Exception:
                stale.append(client)
        for client in stale:
            self._clients.pop(client, None)


chat_manager = ChatManager()


@app.websocket('/ws/chat')
async def chat_socket(websocket: WebSocket) -> None:
    await chat_manager.connect(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await chat_manager.send_personal(websocket, {'type': 'error', 'message': 'Invalid JSON payload.', 'timestamp': _utc_now()})
                continue

            action = payload.get('type')
            if action == 'set_name':
                await chat_manager.rename(websocket, str(payload.get('name', '')))
            elif action == 'chat':
                await chat_manager.message(websocket, str(payload.get('text', '')))
            else:
                await chat_manager.send_personal(websocket, {'type': 'error', 'message': 'Unknown chat action.', 'timestamp': _utc_now()})
    except WebSocketDisconnect:
        await chat_manager.disconnect(websocket)
