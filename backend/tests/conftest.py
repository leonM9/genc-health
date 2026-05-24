"""Shared test helpers — cross-platform .env loading.

Resolves REACT_APP_BACKEND_URL from (in order):
  1. existing OS env var (so CI / users can override)
  2. ../../frontend/.env  (works on both Linux /app and Windows local)
  3. ../../backend/.env   (some users put it here)
  4. fallback to http://localhost:8001 (local dev with backend running)
"""
import os
from pathlib import Path
from dotenv import load_dotenv


def resolve_backend_url() -> str:
    # 1. already in environment?
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

    # 2. look relative to this file: backend/tests/conftest.py
    here = Path(__file__).resolve().parent
    candidates = [
        here.parent.parent / "frontend" / ".env",   # ../../frontend/.env
        here.parent / ".env",                       # ../.env (backend)
        Path("/app/frontend/.env"),                 # absolute (container)
    ]
    for c in candidates:
        if c.exists():
            load_dotenv(c)
            if os.environ.get("REACT_APP_BACKEND_URL"):
                return os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

    # 3. local dev fallback
    return "http://localhost:8001"
