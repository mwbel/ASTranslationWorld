from __future__ import annotations

import base64
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from fastapi import HTTPException, Request

from common.config import AppConfig, UserConfig


TOKEN_TTL_HOURS = 24 * 30


def verify_password(user: UserConfig, password: str | None) -> bool:
    if not password:
        return False
    if user.password_hash:
        return bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
    if user.password is not None:
        return secrets.compare_digest(user.password, password)
    return False


def find_user(config: AppConfig, username: str | None, reseller_code: str | None = None) -> UserConfig | None:
    if not username:
        return None
    for user in config.adapter.users:
        if user.username != username:
            continue
        if user.reseller_code and reseller_code and user.reseller_code != reseller_code:
            continue
        return user
    return None


def issue_token(username: str) -> tuple[str, str]:
    expires_at = datetime.now(UTC) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": username,
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    token_body = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii").rstrip("=")
    return f"adapter.{token_body}.{secrets.token_urlsafe(24)}", expires_at.isoformat()


def login_response(username: str) -> dict[str, Any]:
    token, expires_at = issue_token(username)
    return {
        "ok": True,
        "token": token,
        "access_token": token,
        "expires_at": expires_at,
        "token_expires_at": expires_at,
        "user": {
            "id": username,
            "username": username,
            "display_name": username,
        },
    }


def extract_login_fields(payload: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    username = (
        payload.get("username")
        or payload.get("email")
        or payload.get("account")
        or payload.get("user")
        or payload.get("login")
    )
    password = payload.get("password") or payload.get("passwd") or payload.get("secret")
    reseller_code = (
        payload.get("reseller_code")
        or payload.get("resellerCode")
        or payload.get("channel")
        or payload.get("tenant")
    )
    return str(username) if username is not None else None, str(password) if password is not None else None, str(reseller_code) if reseller_code is not None else None


async def require_user_from_request(request: Request, config: AppConfig) -> UserConfig:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth.split(None, 1)[1]
        if token.startswith("adapter."):
            try:
                encoded = token.split(".", 2)[1]
                padded = encoded + "=" * (-len(encoded) % 4)
                payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
                username = payload.get("sub")
                user = find_user(config, username)
                if user:
                    return user
            except Exception:
                pass

    if config.adapter.users:
        raise HTTPException(status_code=401, detail="Invalid or missing adapter token")
    raise HTTPException(status_code=401, detail="No adapter users configured")


def authenticate_login(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    username, password, reseller_code = extract_login_fields(payload)
    user = find_user(config, username, reseller_code)
    if not user or not verify_password(user, password):
        raise HTTPException(status_code=401, detail="Invalid adapter username or password")
    return login_response(user.username)
