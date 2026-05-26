"""Shared test helpers — cross-platform .env loading + diagnostic banner.

Resolves REACT_APP_BACKEND_URL from (in order):
  1. existing OS env var (so CI / users can override)
  2. ../../frontend/.env  (works on both Linux /app and Windows local)
  3. ../../backend/.env   (some users put it here)
  4. fallback to http://localhost:8001 (local dev with backend running)
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

import pytest


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


# Diagnostic banner — surfaces the target backend so subset runs are debuggable.
@pytest.fixture(scope="session", autouse=True)
def _print_target_backend():
    url = resolve_backend_url()
    sys.stdout.write(f"\n[gen-c tests] target backend: {url}\n")
    sys.stdout.flush()
    yield


def make_account(seed_text: str):
    """Deterministic account from a seed string (so tests across files can coordinate)."""
    import hashlib
    from eth_account import Account
    pk = "0x" + hashlib.sha256(seed_text.encode()).hexdigest()
    return Account.from_key(pk), pk


def sign_message(pk: str, message: str) -> str:
    """Sign a UTF-8 message; always returns a 0x-prefixed hex string."""
    from eth_account import Account
    from eth_account.messages import encode_defunct
    sig = Account.sign_message(encode_defunct(text=message), private_key=pk).signature.hex()
    return sig if sig.startswith("0x") else "0x" + sig


def ensure_user(base_url: str, account, role: str, name: str, department=None, hospital=None) -> bool:
    """Idempotently register a user via /api/users/register. Returns True on success.
    Safe to call repeatedly — server accepts re-registration as an update.
    """
    import time
    import requests
    msg = f"register {role} {account.address} {time.time()}"
    payload = {
        "actor_address": account.address,
        "actor_message": msg,
        "actor_signature": sign_message(account.key.hex(), msg),
        "role": role,
        "name": name,
        "department": department,
        "hospital": hospital,
    }
    r = requests.post(f"{base_url}/api/users/register", json=payload, timeout=30)
    return r.status_code == 200
