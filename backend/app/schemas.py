from datetime import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class WatchItemUpsert(BaseModel):
    asteroid_id: str = Field(min_length=1, max_length=64)
    asteroid_name: str = Field(min_length=1, max_length=255)
    risk_category: str | None = Field(default=None, max_length=32)
    risk_score: int | None = None
    close_approach_date: str | None = Field(default=None, max_length=32)


class WatchItemOut(BaseModel):
    asteroid_id: str
    asteroid_name: str
    risk_category: str | None
    risk_score: int | None
    close_approach_date: str | None
    created_at: datetime
