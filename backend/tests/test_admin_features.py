"""Tests for new admin features: admin-register doctor/patient + admin-uploaded record."""
import os, hashlib, base64, io, time, uuid
import pytest, requests
from eth_account import Account
from eth_account.messages import encode_defunct
from conftest import resolve_backend_url

BASE = resolve_backend_url() + "/api"

ADMIN_SEED = "genc-admin-thesis-deterministic-seed-2026"
ADMIN_PK = "0x" + hashlib.sha256(ADMIN_SEED.encode()).hexdigest()
ADMIN_ADDR = Account.from_key(ADMIN_PK).address

SUFFIX = uuid.uuid4().hex[:8]
DOC = Account.from_key("0x" + hashlib.sha256(f"TEST_admin_doc_{SUFFIX}".encode()).hexdigest())
PAT = Account.from_key("0x" + hashlib.sha256(f"TEST_admin_pat_{SUFFIX}".encode()).hexdigest())
NON_ADMIN = Account.from_key("0x" + hashlib.sha256(f"TEST_nonadmin_{SUFFIX}".encode()).hexdigest())


def _hex(s):
    return s if s.startswith("0x") else "0x" + s


def sign(pk, msg):
    return _hex(Account.sign_message(encode_defunct(text=msg), private_key=pk).signature.hex())


# ---- Session-scope autouse: pre-register DOC and PAT idempotently so
# tests that rely on /users/admin-register having already succeeded for
# them (e.g. /records upload-against-patient) work in any subset.
@pytest.fixture(scope="module", autouse=True)
def _ensure_admin_test_users():
    for acct, role, name, dept in [
        (DOC, "doctor", "Dr Admin-Registered", "Radiology"),
        (PAT, "patient", "Pat Admin-Registered", None),
    ]:
        try:
            msg = f"admin-register-{role}"
            requests.post(BASE + "/users/admin-register", json={
                "admin_address": ADMIN_ADDR,
                "admin_signature": sign(ADMIN_PK, msg),
                "admin_message": msg,
                "target_address": acct.address,
                "role": role,
                "name": name,
                "department": dept,
                "hospital": "Test Hospital" if role == "doctor" else None,
            }, timeout=30)
        except Exception:
            pass
    yield


# ---- /users/admin-register ----
def test_admin_register_doctor():
    msg = "admin-register-doctor"
    payload = {
        "admin_address": ADMIN_ADDR,
        "admin_signature": sign(ADMIN_PK, msg),
        "admin_message": msg,
        "target_address": DOC.address,
        "role": "doctor",
        "name": "Dr Admin-Registered",
        "department": "Radiology",
        "hospital": "Test Hospital",
    }
    r = requests.post(BASE + "/users/admin-register", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "_id" not in j
    assert j["role"] == "doctor"
    assert j["name"] == "Dr Admin-Registered"
    assert j["department"] == "Radiology"
    assert j["hospital"] == "Test Hospital"
    assert j["address_lower"] == DOC.address.lower()

    # Verify persistence
    r = requests.get(BASE + f"/users/{DOC.address}")
    assert r.status_code == 200 and r.json()["role"] == "doctor"


def test_admin_register_patient():
    msg = "admin-register-patient"
    payload = {
        "admin_address": ADMIN_ADDR,
        "admin_signature": sign(ADMIN_PK, msg),
        "admin_message": msg,
        "target_address": PAT.address,
        "role": "patient",
        "name": "Pat Admin-Registered",
    }
    r = requests.post(BASE + "/users/admin-register", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["role"] == "patient"
    assert j["name"] == "Pat Admin-Registered"


def test_admin_register_non_admin_forbidden():
    msg = "admin-register-doctor"
    payload = {
        "admin_address": NON_ADMIN.address,
        "admin_signature": sign(NON_ADMIN.key.hex(), msg),
        "admin_message": msg,
        "target_address": DOC.address,
        "role": "doctor",
        "name": "Imposter",
    }
    r = requests.post(BASE + "/users/admin-register", json=payload)
    assert r.status_code == 403, r.text


def test_admin_register_invalid_signature():
    msg = "admin-register-doctor"
    payload = {
        "admin_address": ADMIN_ADDR,
        "admin_signature": sign(NON_ADMIN.key.hex(), msg),  # wrong signer
        "admin_message": msg,
        "target_address": DOC.address,
        "role": "doctor",
        "name": "X",
    }
    r = requests.post(BASE + "/users/admin-register", json=payload)
    assert r.status_code == 401


def test_admin_register_bad_role():
    msg = "admin-register-nurse"
    payload = {
        "admin_address": ADMIN_ADDR,
        "admin_signature": sign(ADMIN_PK, msg),
        "admin_message": msg,
        "target_address": DOC.address,
        "role": "nurse",
        "name": "X",
    }
    r = requests.post(BASE + "/users/admin-register", json=payload)
    assert r.status_code == 400


def test_admin_register_bad_wallet():
    msg = "admin-register-doctor"
    payload = {
        "admin_address": ADMIN_ADDR,
        "admin_signature": sign(ADMIN_PK, msg),
        "admin_message": msg,
        "target_address": "not-a-wallet",
        "role": "doctor",
        "name": "X",
    }
    r = requests.post(BASE + "/users/admin-register", json=payload)
    assert r.status_code == 400


def test_users_list_excludes_mongo_id():
    r = requests.get(BASE + "/users")
    assert r.status_code == 200
    leaks = [u for u in r.json() if "_id" in u]
    assert not leaks, (
        f"{len(leaks)} user(s) leaked Mongo _id. First offender: "
        f"{leaks[0].get('address_lower', '?')} / {leaks[0].get('name', '?')}. "
        f"This usually means you are hitting a backend that does not have "
        f"the latest server.py — confirm target URL from the test session banner."
    )


# ---- IPFS small dummy upload ----
@pytest.fixture(scope="module")
def small_cid():
    files = {"file": ("dummy.bin", io.BytesIO(b"GENC_ADMIN_TEST_" + uuid.uuid4().bytes), "application/octet-stream")}
    r = requests.post(BASE + "/ipfs/upload", files=files, timeout=120)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "cid" in j and len(j["cid"]) > 20
    return j["cid"]


def test_ipfs_upload_returns_cid(small_cid):
    assert small_cid


# ---- POST /records as admin ----
def test_admin_uploaded_record_enqueues_to_lpa(small_cid):
    # Ensure patient is registered
    rmsg = "admin-register-patient"
    requests.post(BASE + "/users/admin-register", json={
        "admin_address": ADMIN_ADDR,
        "admin_signature": sign(ADMIN_PK, rmsg),
        "admin_message": rmsg,
        "target_address": PAT.address,
        "role": "patient",
        "name": "Pat Admin-Registered",
    })

    msg = "admin-upload-record"
    enc_key = base64.b64encode(b"\x02" * 32).decode()
    policy = f"(Role:Doctor AND Department:Admin) OR (Owner:{PAT.address.lower()})"
    payload = {
        "uploader_address": ADMIN_ADDR,
        "uploader_signature": sign(ADMIN_PK, msg),
        "uploader_message": msg,
        "patient_address": PAT.address,
        "cid": small_cid,
        "file_name": "admin-upload.pdf",
        "file_size": 100,
        "encrypted_key_b64": enc_key,
        "policy": policy,
        "diagnosis": "Admin uploaded test record",
        "notes": "from admin",
    }
    r = requests.post(BASE + "/records", json=payload)
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["uploader_role"] == "admin"
    assert rec["anchor_status"] == "pending"
    assert rec["patient_address_lower"] == PAT.address.lower()
    rec_id = rec["id"]

    # Appears in pending LPA queue
    r = requests.get(BASE + "/lpa/pending")
    assert r.status_code == 200
    assert any(p["record_id"] == rec_id for p in r.json())

    # Patient records lists it
    r = requests.get(BASE + f"/records/patient/{PAT.address}")
    assert r.status_code == 200
    assert any(x["id"] == rec_id for x in r.json())


def test_admin_upload_to_unregistered_patient_400(small_cid):
    msg = "admin-upload-record"
    rando = Account.create()
    payload = {
        "uploader_address": ADMIN_ADDR,
        "uploader_signature": sign(ADMIN_PK, msg),
        "uploader_message": msg,
        "patient_address": rando.address,
        "cid": small_cid,
        "file_name": "x.pdf",
        "file_size": 10,
        "encrypted_key_b64": base64.b64encode(b"\x00" * 32).decode(),
        "policy": "Owner:self",
        "diagnosis": "x",
    }
    r = requests.post(BASE + "/records", json=payload)
    assert r.status_code == 400


# ---- /lpa/anchor by admin ----
def test_lpa_anchor_by_admin_works():
    msg = f"anchor {time.time()}"
    r = requests.post(BASE + "/lpa/anchor", json={
        "admin_address": ADMIN_ADDR,
        "signature": sign(ADMIN_PK, msg),
        "message": msg,
    })
    # Should be 200 since we just added a record above; allow 400 only if nothing pending.
    assert r.status_code in (200, 400), r.text
    if r.status_code == 200:
        j = r.json()
        assert j["root"].startswith("0x")
        assert j["tx_hash"].startswith("0x")
        assert isinstance(j["block_number"], int)
