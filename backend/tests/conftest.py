"""Shared test helpers — cross-platform .env loading + diagnostic banner.

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


def normalize_pk(pk) -> str:
    """Normalize any private-key representation to a "0x..." hex string.

    Handles all variants produced by different eth_account / hexbytes versions:
      • bytes / bytearray              -> "0x" + hex
      • HexBytes (has .hex())          -> ensure "0x" prefix
      • str "abc..."  (no prefix)      -> "0x" + str
      • str "0xabc..." (with prefix)   -> unchanged
    """
    if isinstance(pk, (bytes, bytearray)):
        return "0x" + pk.hex()
    if isinstance(pk, str):
        return pk if pk.startswith("0x") else "0x" + pk
    # HexBytes-like object
    if hasattr(pk, "hex"):
        s = pk.hex()
        return s if s.startswith("0x") else "0x" + s
    raise TypeError(f"Unsupported private-key type: {type(pk)!r}")


def sign_message(pk, message: str) -> str:
    """Sign a UTF-8 message; always returns a 0x-prefixed hex string.

    Accepts any private-key format (bytes, HexBytes, hex string with or
    without "0x" prefix). This bullet-proofs the helper against differences
    between eth_account 0.10 / 0.11 / 0.12 / 0.13+ and hexbytes < / >= 1.0.
    """
    from eth_account import Account
    from eth_account.messages import encode_defunct
    pk_hex = normalize_pk(pk)
    sig = Account.sign_message(encode_defunct(text=message), private_key=pk_hex).signature.hex()
    return sig if sig.startswith("0x") else "0x" + sig


def make_account(seed_text: str):
    """Deterministic account from a seed string."""
    import hashlib
    from eth_account import Account
    pk = "0x" + hashlib.sha256(seed_text.encode()).hexdigest()
    return Account.from_key(pk), pk


def ensure_user(base_url: str, account, role: str, name: str, department=None, hospital=None) -> bool:
    """Idempotently register a user via /api/users/register."""
    import time
    import requests
    msg = f"register {role} {account.address} {time.time()}"
    payload = {
        "actor_address": account.address,
        "actor_message": msg,
        "actor_signature": sign_message(account.key, msg),
        "role": role,
        "name": name,
        "department": department,
        "hospital": hospital,
    }
    r = requests.post(f"{base_url}/api/users/register", json=payload, timeout=30)
    return r.status_code == 200


# ── pytest hook: always-visible banner showing which backend tests target ──
def pytest_report_header(config):
    """Shown at the top of pytest output regardless of -v / -s flags."""
    try:
        url = resolve_backend_url()
    except Exception as e:
        url = f"<resolve error: {e}>"

    # Detect eth_account / hexbytes versions so PK-format mismatches surface early
    try:
        import eth_account
        from eth_account import Account
        eth_ver = getattr(eth_account, "__version__", "?")
    except Exception:
        eth_ver = "<not installed>"
    try:
        import hexbytes
        hb_ver = getattr(hexbytes, "__version__", "?")
    except Exception:
        hb_ver = "<not installed>"

    return [
        f"gen-c target backend: {url}",
        f"gen-c crypto libs: eth_account={eth_ver} · hexbytes={hb_ver}",
    ]



# ── Auto-categorize every test into unit / integration / security buckets ──
# Keyword-driven so adding new tests requires zero markup. Run with:
#   pytest -m unit          (single-endpoint validation)
#   pytest -m integration   (multi-step end-to-end flows)
#   pytest -m security      (attacks, tamper, role/sig violations)
SECURITY_KEYWORDS = (
    "invalid", "forbidden", "rejected", "blocked", "unauthorized",
    "bad_role", "bad_wallet", "tampered", "requires_auth", "mismatch",
    "non_admin", "non_doctor", "non_patient", "non_owner",
    "unknown_anchor", "decline_invalid", "target_not_doctor",
    "unregistered_patient_400",
)
INTEGRATION_KEYWORDS = (
    "_flow", "anchor_and_stats", "anchor_by_admin_works",
    "records_for_patient", "records_for_doctor", "records_with_upload_request_id",
    "generate_patient_success", "generate_admin_path", "generate_pending_record",
    "generate_redactions", "verify_valid",
    "decrypt_key_owner_allowed", "decrypt_policy_cardiology",
    "access_request_and_grant", "upload_request_create_success",
    "upload_request_get_for_doctor", "upload_request_get_for_patient",
    "decline_by_assigned", "admin_uploaded_record_enqueues_to_lpa",
    "register_self_doctor_and_patient", "register_idempotent_update",
    "hospital_roundtrip", "lpa_pending_enriched",
)


def pytest_configure(config):
    config.addinivalue_line("markers", "unit: single-endpoint unit test")
    config.addinivalue_line("markers", "integration: multi-step end-to-end flow")
    config.addinivalue_line("markers", "security: attack / tamper / authz violation")


def pytest_collection_modifyitems(config, items):
    import pytest
    for item in items:
        name = item.name.lower()
        if any(kw in name for kw in SECURITY_KEYWORDS):
            item.add_marker(pytest.mark.security)
        elif any(kw in name for kw in INTEGRATION_KEYWORDS):
            item.add_marker(pytest.mark.integration)
        else:
            item.add_marker(pytest.mark.unit)
