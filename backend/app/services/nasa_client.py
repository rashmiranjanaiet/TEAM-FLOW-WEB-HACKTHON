from datetime import date, datetime, timedelta, timezone

import requests
from fastapi import HTTPException

from app.config import NASA_API_KEY, NASA_FEED_URL, NASA_LOOKUP_URL

_feed_cache: dict[tuple[str, str], tuple[datetime, dict]] = {}
_lookup_cache: dict[str, tuple[datetime, dict]] = {}
_FEED_TTL_SECONDS = 90
_LOOKUP_TTL_SECONDS = 60 * 60 * 6


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _cache_get(cache: dict, key: str | tuple[str, str], ttl_seconds: int) -> dict | None:
    cached = cache.get(key)
    if not cached:
        return None
    ts, payload = cached
    if _now_utc() - ts > timedelta(seconds=ttl_seconds):
        return None
    return payload


def _cache_set(cache: dict, key: str | tuple[str, str], payload: dict) -> None:
    cache[key] = (_now_utc(), payload)


def _looks_like_rate_limit(exc: requests.RequestException) -> bool:
    response = getattr(exc, 'response', None)
    status = getattr(response, 'status_code', None)
    if status == 429:
        return True
    if status in (401, 403) and response is not None:
        try:
            body = response.json()
            text = str(body).lower()
        except ValueError:
            text = (response.text or '').lower()
        if 'rate limit' in text or 'too many requests' in text:
            return True
    return False


def _raise_nasa_error(exc: requests.RequestException) -> None:
    response = getattr(exc, 'response', None)
    status = getattr(response, 'status_code', None)
    if _looks_like_rate_limit(exc):
        raise HTTPException(
            status_code=503,
            detail={
                'error': 'NASA_RATE_LIMIT',
                'message': 'NASA API rate limit reached. Retry shortly.',
            },
        ) from exc
    if status == 401 or status == 403:
        raise HTTPException(
            status_code=502,
            detail={
                'error': 'NASA_AUTH_ERROR',
                'message': 'NASA API key rejected the request.',
            },
        ) from exc
    raise HTTPException(
        status_code=502,
        detail={
            'error': 'NASA_UPSTREAM_ERROR',
            'message': 'Unable to fetch data from NASA NeoWs.',
            'upstream_status': status,
        },
    ) from exc


def fetch_feed(start_date: date, end_date: date) -> dict:
    cache_key = (start_date.isoformat(), end_date.isoformat())
    fresh_cache = _cache_get(_feed_cache, cache_key, _FEED_TTL_SECONDS)
    if fresh_cache is not None:
        return fresh_cache

    params = {
        'start_date': cache_key[0],
        'end_date': cache_key[1],
        'api_key': NASA_API_KEY,
    }
    try:
        response = requests.get(NASA_FEED_URL, params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
        _cache_set(_feed_cache, cache_key, payload)
        return payload
    except requests.RequestException as exc:
        if _looks_like_rate_limit(exc):
            stale = _feed_cache.get(cache_key)
            if stale:
                return stale[1]
        _raise_nasa_error(exc)


def fetch_feed_range(start_date: date, end_date: date) -> dict:
    if end_date < start_date:
        return {'links': {}, 'element_count': 0, 'near_earth_objects': {}}

    if (end_date - start_date).days <= 7:
        return fetch_feed(start_date, end_date)

    merged: dict[str, list] = {}
    links: dict = {}
    cursor = start_date
    while cursor <= end_date:
        chunk_end = min(cursor + timedelta(days=6), end_date)
        chunk = fetch_feed(cursor, chunk_end)
        if not links:
            links = chunk.get('links', {})
        for day, rows in (chunk.get('near_earth_objects') or {}).items():
            merged.setdefault(day, []).extend(rows or [])
        cursor = chunk_end + timedelta(days=1)

    total = sum(len(rows) for rows in merged.values())
    return {'links': links, 'element_count': total, 'near_earth_objects': merged}


def fetch_lookup(asteroid_id: str) -> dict:
    fresh_cache = _cache_get(_lookup_cache, asteroid_id, _LOOKUP_TTL_SECONDS)
    if fresh_cache is not None:
        return fresh_cache

    params = {'api_key': NASA_API_KEY}
    try:
        response = requests.get(f'{NASA_LOOKUP_URL}/{asteroid_id}', params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
        _cache_set(_lookup_cache, asteroid_id, payload)
        return payload
    except requests.RequestException as exc:
        if _looks_like_rate_limit(exc):
            stale = _lookup_cache.get(asteroid_id)
            if stale:
                return stale[1]
        _raise_nasa_error(exc)
