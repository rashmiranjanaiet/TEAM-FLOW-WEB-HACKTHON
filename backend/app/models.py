from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    watch_items = relationship('WatchlistItem', back_populates='user', cascade='all, delete-orphan')


class WatchlistItem(Base):
    __tablename__ = 'watchlist_items'
    __table_args__ = (UniqueConstraint('user_id', 'asteroid_id', name='uq_user_asteroid'),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    asteroid_id = Column(String(64), nullable=False)
    asteroid_name = Column(String(255), nullable=False)
    risk_category = Column(String(32), nullable=True)
    risk_score = Column(Integer, nullable=True)
    close_approach_date = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    user = relationship('User', back_populates='watch_items')
