from datetime import date, datetime, timezone


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def risk_analysis(diameter_m, miss_distance_km, velocity_kps, hazardous):
    score = 0
    if hazardous:
        score += 50

    if diameter_m is not None:
        if diameter_m >= 1000:
            score += 30
        elif diameter_m >= 300:
            score += 20
        elif diameter_m >= 140:
            score += 10

    if miss_distance_km is not None:
        if miss_distance_km <= 750000:
            score += 30
        elif miss_distance_km <= 3000000:
            score += 20
        elif miss_distance_km <= 7500000:
            score += 10

    if velocity_kps is not None:
        if velocity_kps >= 25:
            score += 15
        elif velocity_kps >= 15:
            score += 10
        elif velocity_kps >= 8:
            score += 5

    if score >= 70:
        category = 'High'
    elif score >= 40:
        category = 'Medium'
    else:
        category = 'Low'
    return score, category


def pick_close_approach(asteroid, approach_date):
    entries = asteroid.get('close_approach_data') or []
    for idx, entry in enumerate(entries):
        if entry.get('close_approach_date') == approach_date and entry.get('orbiting_body') == 'Earth':
            return idx, entry
    for idx, entry in enumerate(entries):
        if entry.get('orbiting_body') == 'Earth':
            return idx, entry
    if entries:
        return 0, entries[0]
    return None, {}


def normalize_feed_payload(feed_payload):
    neo_by_date = feed_payload.get('near_earth_objects', {})
    items = []

    for approach_date, asteroids in neo_by_date.items():
        for asteroid in asteroids:
            close_idx, close_data = pick_close_approach(asteroid, approach_date)
            rel_vel = close_data.get('relative_velocity', {})
            miss_dist = close_data.get('miss_distance', {})
            diameter = asteroid.get('estimated_diameter', {}).get('meters', {})

            max_diameter_m = to_float(diameter.get('estimated_diameter_max'))
            min_diameter_m = to_float(diameter.get('estimated_diameter_min'))
            avg_diameter_m = None
            if max_diameter_m is not None and min_diameter_m is not None:
                avg_diameter_m = (max_diameter_m + min_diameter_m) / 2
            elif max_diameter_m is not None:
                avg_diameter_m = max_diameter_m
            elif min_diameter_m is not None:
                avg_diameter_m = min_diameter_m

            velocity_kps = to_float(rel_vel.get('kilometers_per_second'))
            miss_distance_km = to_float(miss_dist.get('kilometers'))
            hazardous = bool(asteroid.get('is_potentially_hazardous_asteroid', False))

            risk_score, risk_category = risk_analysis(
                diameter_m=avg_diameter_m,
                miss_distance_km=miss_distance_km,
                velocity_kps=velocity_kps,
                hazardous=hazardous,
            )

            items.append(
                {
                    'id': asteroid.get('id'),
                    'name': asteroid.get('name'),
                    'nasa_jpl_url': asteroid.get('nasa_jpl_url'),
                    'close_approach_date': close_data.get('close_approach_date', approach_date),
                    'orbiting_body': close_data.get('orbiting_body', 'Earth'),
                    'estimated_diameter_m': round(avg_diameter_m, 3) if avg_diameter_m is not None else None,
                    'estimated_diameter_km': round(avg_diameter_m / 1000, 6) if avg_diameter_m is not None else None,
                    'relative_velocity_kps': round(velocity_kps, 6) if velocity_kps is not None else None,
                    'relative_velocity_kph': round(velocity_kps * 3600, 3) if velocity_kps is not None else None,
                    'miss_distance_km': round(miss_distance_km, 3) if miss_distance_km is not None else None,
                    'is_potentially_hazardous': hazardous,
                    'risk_score': risk_score,
                    'risk_category': risk_category,
                    'source_record': {
                        'neo_reference_id': asteroid.get('neo_reference_id'),
                        'close_approach_index': close_idx,
                    },
                }
            )

    items.sort(key=lambda x: x['risk_score'], reverse=True)
    return items


def normalize_lookup_payload(payload):
    diameter = payload.get('estimated_diameter', {}).get('meters', {})
    min_diameter_m = to_float(diameter.get('estimated_diameter_min'))
    max_diameter_m = to_float(diameter.get('estimated_diameter_max'))
    avg_diameter_m = None
    if min_diameter_m is not None and max_diameter_m is not None:
        avg_diameter_m = (min_diameter_m + max_diameter_m) / 2
    elif min_diameter_m is not None:
        avg_diameter_m = min_diameter_m
    elif max_diameter_m is not None:
        avg_diameter_m = max_diameter_m

    close_entries = payload.get('close_approach_data') or []
    close_data = close_entries[0] if close_entries else {}
    velocity_kps = to_float((close_data.get('relative_velocity') or {}).get('kilometers_per_second'))
    miss_distance_km = to_float((close_data.get('miss_distance') or {}).get('kilometers'))
    hazardous = bool(payload.get('is_potentially_hazardous_asteroid', False))

    risk_score, risk_category = risk_analysis(avg_diameter_m, miss_distance_km, velocity_kps, hazardous)
    orbital_data = payload.get('orbital_data') or {}

    orbital_elements = {
        'semi_major_axis_au': to_float(orbital_data.get('semi_major_axis')),
        'eccentricity': to_float(orbital_data.get('eccentricity')),
        'inclination_deg': to_float(orbital_data.get('inclination')),
        'ascending_node_longitude_deg': to_float(orbital_data.get('ascending_node_longitude')),
        'perihelion_argument_deg': to_float(orbital_data.get('perihelion_argument')),
        'mean_anomaly_deg': to_float(orbital_data.get('mean_anomaly')),
        'mean_motion_deg_per_day': to_float(orbital_data.get('mean_motion')),
        'epoch_osculation': orbital_data.get('epoch_osculation'),
    }

    return {
        'id': payload.get('id'),
        'name': payload.get('name'),
        'nasa_jpl_url': payload.get('nasa_jpl_url'),
        'close_approach_date': close_data.get('close_approach_date'),
        'orbiting_body': close_data.get('orbiting_body'),
        'estimated_diameter_m': round(avg_diameter_m, 3) if avg_diameter_m is not None else None,
        'estimated_diameter_km': round(avg_diameter_m / 1000, 6) if avg_diameter_m is not None else None,
        'relative_velocity_kps': round(velocity_kps, 6) if velocity_kps is not None else None,
        'relative_velocity_kph': round(velocity_kps * 3600, 3) if velocity_kps is not None else None,
        'miss_distance_km': round(miss_distance_km, 3) if miss_distance_km is not None else None,
        'is_potentially_hazardous': hazardous,
        'risk_score': risk_score,
        'risk_category': risk_category,
        'raw_close_approach_count': len(close_entries),
        'orbital_elements': orbital_elements,
    }


def build_meta(source_endpoint):
    return {
        'source': 'NASA NeoWs',
        'source_endpoint': source_endpoint,
        'source_format': 'JSON',
        'retrieved_at_utc': datetime.now(timezone.utc).isoformat(),
        'processing_version': '1.0.0',
        'normalization': {
            'diameter_unit': 'm',
            'velocity_unit': 'km/s',
            'distance_unit': 'km',
            'close_approach_date_format': 'YYYY-MM-DD',
            'null_policy': 'missing numeric values are returned as null',
        },
    }


def build_feed_response(start_date: date, end_date: date, items):
    return {
        'meta': build_meta('https://api.nasa.gov/neo/rest/v1/feed'),
        'start_date': start_date.isoformat(),
        'end_date': end_date.isoformat(),
        'asteroid_count': len(items),
        'items': items,
    }


def build_lookup_response(asteroid_id: str, data: dict):
    return {
        'meta': build_meta(f'https://api.nasa.gov/neo/rest/v1/neo/{asteroid_id}'),
        'item': data,
    }
