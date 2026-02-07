import os
from pathlib import Path

from dotenv import load_dotenv

_CONFIG_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _CONFIG_DIR.parent
_PROJECT_DIR = _BACKEND_DIR.parent
load_dotenv(_PROJECT_DIR / '.env')
load_dotenv(_BACKEND_DIR / '.env')

NASA_API_KEY = os.getenv('NASA_API_KEY', 'DEMO_KEY')
NASA_FEED_URL = 'https://api.nasa.gov/neo/rest/v1/feed'
NASA_LOOKUP_URL = 'https://api.nasa.gov/neo/rest/v1/neo'

JWT_SECRET = os.getenv('JWT_SECRET', 'change-me')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRE_MINUTES = int(os.getenv('JWT_EXPIRE_MINUTES', '120'))

POSTGRES_HOST = os.getenv('POSTGRES_HOST', 'localhost')
POSTGRES_PORT = os.getenv('POSTGRES_PORT', '5432')
POSTGRES_DB = os.getenv('POSTGRES_DB', 'nasa')
POSTGRES_USER = os.getenv('POSTGRES_USER', 'nasa_user')
POSTGRES_PASSWORD = os.getenv('POSTGRES_PASSWORD', 'nasa_pass')

DATABASE_URL = os.getenv('DATABASE_URL') or (
    f'postgresql+psycopg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}'
)
SQLITE_FALLBACK_URL = 'sqlite:///./nasa_local.db'
