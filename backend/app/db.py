from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import DATABASE_URL, SQLITE_FALLBACK_URL

Base = declarative_base()

def _engine_for(url: str):
    if url.startswith('sqlite'):
        return create_engine(url, connect_args={'check_same_thread': False})
    if url.startswith('postgresql'):
        return create_engine(url, pool_pre_ping=True, connect_args={'connect_timeout': 3})
    return create_engine(url, pool_pre_ping=True)


engine = _engine_for(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
_active_db_url = DATABASE_URL


def init_db() -> str:
    global engine
    global _active_db_url

    try:
        with engine.connect() as conn:
            conn.execute(text('SELECT 1'))
        Base.metadata.create_all(bind=engine)
        return _active_db_url
    except (OperationalError, SQLAlchemyError):
        if _active_db_url.startswith('postgresql'):
            engine = _engine_for(SQLITE_FALLBACK_URL)
            SessionLocal.configure(bind=engine)
            Base.metadata.create_all(bind=engine)
            _active_db_url = SQLITE_FALLBACK_URL
            return _active_db_url
        raise


def get_active_db_url() -> str:
    return _active_db_url


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
