import os
from datetime import date, timedelta

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

load_dotenv()

NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")
NASA_FEED_URL = "https://api.nasa.gov/neo/rest/v1/feed"

app = FastAPI(title="Cosmic Watch API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_float(value: str | float | int | None) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _risk_analysis(
    diameter_m: float, miss_distance_km: float, velocity_kps: float, hazardous: bool
) -> tuple[int, str]:
    score = 0

    if hazardous:
        score += 50

    if diameter_m >= 1000:
        score += 30
    elif diameter_m >= 300:
        score += 20
    elif diameter_m >= 140:
        score += 10

    if miss_distance_km <= 750_000:
        score += 30
    elif miss_distance_km <= 3_000_000:
        score += 20
    elif miss_distance_km <= 7_500_000:
        score += 10

    if velocity_kps >= 25:
        score += 15
    elif velocity_kps >= 15:
        score += 10
    elif velocity_kps >= 8:
        score += 5

    if score >= 70:
        return score, "High"
    if score >= 40:
        return score, "Medium"
    return score, "Low"


def _extract_neo_items(feed_payload: dict) -> list[dict]:
    neo_by_date = feed_payload.get("near_earth_objects", {})
    items: list[dict] = []

    for approach_date, asteroids in neo_by_date.items():
        for asteroid in asteroids:
            close_data = (asteroid.get("close_approach_data") or [{}])[0]
            rel_vel = close_data.get("relative_velocity", {})
            miss_dist = close_data.get("miss_distance", {})
            diameter = asteroid.get("estimated_diameter", {}).get("meters", {})

            max_diameter_m = _to_float(diameter.get("estimated_diameter_max"))
            min_diameter_m = _to_float(diameter.get("estimated_diameter_min"))
            avg_diameter_m = (
                (max_diameter_m + min_diameter_m) / 2 if (max_diameter_m or min_diameter_m) else 0.0
            )
            velocity_kps = _to_float(rel_vel.get("kilometers_per_second"))
            miss_distance_km = _to_float(miss_dist.get("kilometers"))
            hazardous = bool(asteroid.get("is_potentially_hazardous_asteroid", False))

            score, category = _risk_analysis(
                diameter_m=avg_diameter_m,
                miss_distance_km=miss_distance_km,
                velocity_kps=velocity_kps,
                hazardous=hazardous,
            )

            items.append(
                {
                    "id": asteroid.get("id"),
                    "name": asteroid.get("name"),
                    "nasa_jpl_url": asteroid.get("nasa_jpl_url"),
                    "close_approach_date": close_data.get("close_approach_date", approach_date),
                    "estimated_diameter_m": round(avg_diameter_m, 2),
                    "relative_velocity_kps": round(velocity_kps, 3),
                    "miss_distance_km": round(miss_distance_km, 2),
                    "is_potentially_hazardous": hazardous,
                    "risk_score": score,
                    "risk_category": category,
                }
            )

    items.sort(key=lambda x: x["risk_score"], reverse=True)
    return items


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Cosmic Watch API is running"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/neo/feed")
def get_neo_feed(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
) -> dict:
    resolved_start = start_date or date.today()
    resolved_end = end_date or (resolved_start + timedelta(days=2))

    if resolved_end < resolved_start:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")
    if (resolved_end - resolved_start).days > 7:
        raise HTTPException(status_code=400, detail="date range cannot exceed 7 days")

    params = {
        "start_date": resolved_start.isoformat(),
        "end_date": resolved_end.isoformat(),
        "api_key": NASA_API_KEY,
    }

    try:
        response = requests.get(NASA_FEED_URL, params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to fetch NASA NEO feed: {exc}",
        ) from exc

    items = _extract_neo_items(payload)
    return {
        "start_date": resolved_start.isoformat(),
        "end_date": resolved_end.isoformat(),
        "asteroid_count": len(items),
        "items": items,
    }


@app.get("/api/neo/today-summary")
def get_today_summary() -> dict:
    today = date.today().isoformat()
    params = {
        "start_date": today,
        "end_date": today,
        "api_key": NASA_API_KEY,
    }
    try:
        response = requests.get(NASA_FEED_URL, params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to fetch NASA NEO feed: {exc}",
        ) from exc

    items = _extract_neo_items(payload)
    high = sum(1 for item in items if item["risk_category"] == "High")
    medium = sum(1 for item in items if item["risk_category"] == "Medium")
    low = sum(1 for item in items if item["risk_category"] == "Low")

    return {
        "date": today,
        "total": len(items),
        "high_risk": high,
        "medium_risk": medium,
        "low_risk": low,
    }
