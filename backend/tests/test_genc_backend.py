"""Gen C dApp backend tests covering auth, users, records, IPFS, LPA, access grants."""
import os, hashlib, base64, io, time, uuid
import pytest, requests
from eth_account import Account
from eth_account.messages import encode_defunct
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"

ADMIN_SEED = "genc-admin-thesis-deterministic-seed-2026"
ADMIN_PK = "0x" + hashlib.sha256(ADMIN_SEED.encode()).hexdigest()
ADMIN_ADDR = Account.from_key(ADMIN_PK).address

# Fixed test wallets
DOCTOR = Account.from_key("0x" + hashlib.sha256(b"TEST_doctor_v1").hexdigest())
PATIENT = Account.from_key("0x" + hashlib.sha256(b"TEST_patient_v1").hexdigest())
OTHER_DOCTOR = Account.from_key("0x" + hashlib.sha256(b"TEST_other_doc_v1").hexdigest())


def sign(pk, msg):
    return Account.sign_message(encode_defunct(text=msg), private_key=pk).signature.hex()


def admin_sign(msg):
    s = sign(ADMIN_PK, msg)
    return {"actor_address": ADMIN_ADDR, "actor_message": msg, "actor_signature": s if s.startswith("0x") else "0x"+s}


def _hex(s):
    return s if s.startswith("0x") else "0x" + s


# ---- Health ----
def test_root():
    r = requests.get(BASE + "/")
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] is True
    assert j["admin_address"].lower() == ADMIN_ADDR.lower()


def test_admin_info():
    r = requests.get(BASE + "/admin/info")
    assert r.status_code == 200
    j = r.json()
    assert j["address"].lower() == ADMIN_ADDR.lower()
    assert j["private_key"].lower() == ADMIN_PK.lower()


# ---- Auth ----
def test_auth_verify_admin():
    msg = f"login {time.time()}"
    sig = _hex(sign(ADMIN_PK, msg))
    r = requests.post(BASE + "/auth/verify", json={"address": ADMIN_ADDR, "message": msg, "signature": sig})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"


def test_auth_verify_unregistered():
    new_acct = Account.create()
    msg = "hi"
    sig = _hex(sign(new_acct.key.hex(), msg))
    r = requests.post(BASE + "/auth/verify", json={"address": new_acct.address, "message": msg, "signature": sig})
    assert r.status_code == 200
    assert r.json()["role"] == "unregistered"


def test_auth_verify_invalid_signature():
    msg = "hi"
    sig = _hex(sign(ADMIN_PK, "different message"))
    r = requests.post(BASE + "/auth/verify", json={"address": ADMIN_ADDR, "message": msg, "signature": sig})
    assert r.status_code == 401


# ---- Users registration ----
def _cleanup():
    # Best-effort cleanup of test users/records via direct mongo not used; rely on unique pk's
    pass


def test_register_requires_admin():
    msg = "register doctor"
    # Non-admin actor
    sig = _hex(sign(DOCTOR.key.hex(), msg))
    r = requests.post(BASE + "/users/register", json={
        "actor_address": DOCTOR.address, "actor_signature": sig, "actor_message": msg,
        "role": "doctor", "name": "X", "address": DOCTOR.address, "department": "Cardiology"
    })
    assert r.status_code == 403


def test_register_doctor_and_patient():
    # Cleanup first: attempt fetch; if exists, skip insert
    msg = "register users batch"
    base_sig = admin_sign(msg)

    for acct, role, dept, name in [
        (DOCTOR, "doctor", "Cardiology", "Dr Test"),
        (PATIENT, "patient", None, "Pat Test"),
        (OTHER_DOCTOR, "doctor", "Radiology", "Dr Other"),
    ]:
        payload = {**base_sig, "role": role, "name": name, "address": acct.address, "department": dept}
        r = requests.post(BASE + "/users/register", json=payload)
        assert r.status_code in (200, 409), f"{role} {acct.address}: {r.status_code} {r.text}"

    # Duplicate clear test
    payload = {**base_sig, "role": "doctor", "name": "Dr Test", "address": DOCTOR.address, "department": "Cardiology"}
    r = requests.post(BASE + "/users/register", json=payload)
    assert r.status_code == 409

    # GET verify
    r = requests.get(BASE + f"/users/{DOCTOR.address}")
    assert r.status_code == 200
    assert r.json()["role"] == "doctor"

    r = requests.get(BASE + "/users")
    assert r.status_code == 200
    addrs = [u["address_lower"] for u in r.json()]
    assert DOCTOR.address.lower() in addrs
    assert PATIENT.address.lower() in addrs


# ---- IPFS ----
@pytest.fixture(scope="module")
def pinata_cid():
    payload = b"TEST_GENC_" + uuid.uuid4().bytes
    files = {"file": ("blob.bin", io.BytesIO(payload), "application/octet-stream")}
    r = requests.post(BASE + "/ipfs/upload", files=files, timeout=120)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "cid" in j
    # Pinata CIDs start with 'Qm' or 'bafy'/'bafk' (CIDv1)
    assert len(j["cid"]) > 20
    return j["cid"]


def test_ipfs_upload(pinata_cid):
    assert pinata_cid


# ---- Records ----
@pytest.fixture(scope="module")
def record_id(pinata_cid):
    # Ensure users exist first
    test_register_doctor_and_patient()
    msg = "upload record"
    sig = _hex(sign(DOCTOR.key.hex(), msg))
    enc_key = base64.b64encode(b"\x00" * 32).decode()
    policy = f"(Role:Doctor AND Department:Cardiology) OR (Owner:{PATIENT.address.lower()})"
    payload = {
        "uploader_address": DOCTOR.address, "uploader_signature": sig, "uploader_message": msg,
        "patient_address": PATIENT.address, "cid": pinata_cid, "file_name": "report.pdf",
        "file_size": 1024, "encrypted_key_b64": enc_key, "policy": policy,
        "diagnosis": "Hypertension", "notes": "test"
    }
    r = requests.post(BASE + "/records", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["anchor_status"] == "pending"
    return j["id"]


def test_records_for_patient(record_id):
    r = requests.get(BASE + f"/records/patient/{PATIENT.address}")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert record_id in ids


def test_records_for_doctor(record_id):
    r = requests.get(BASE + f"/records/doctor/{DOCTOR.address}")
    assert r.status_code == 200
    j = r.json()
    assert "uploaded" in j and "accessible" in j and "grants" in j
    assert any(x["id"] == record_id for x in j["uploaded"])


# ---- Decrypt key access checks ----
def test_decrypt_key_owner_allowed(record_id):
    msg = "decrypt"
    sig = _hex(sign(PATIENT.key.hex(), msg))
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": PATIENT.address,
        "signature": sig, "message": msg
    })
    assert r.status_code == 200, r.text
    assert "encrypted_key_b64" in r.json()


def test_decrypt_key_unauthorized_doctor(record_id):
    msg = "decrypt"
    sig = _hex(sign(OTHER_DOCTOR.key.hex(), msg))
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": OTHER_DOCTOR.address,
        "signature": sig, "message": msg
    })
    # OTHER_DOCTOR is Radiology, policy needs Cardiology, no grant -> 403
    assert r.status_code == 403, r.text


def test_decrypt_policy_cardiology_doctor(record_id):
    # DOCTOR is Cardiology -> policy satisfied
    msg = "decrypt"
    sig = _hex(sign(DOCTOR.key.hex(), msg))
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": DOCTOR.address,
        "signature": sig, "message": msg
    })
    assert r.status_code == 200, r.text


# ---- Access request & grant ----
def test_access_request_and_grant_flow(record_id):
    # OTHER_DOCTOR requests access
    r = requests.post(BASE + "/access/request", json={
        "doctor_address": OTHER_DOCTOR.address, "patient_address": PATIENT.address,
        "reason": "second opinion"
    })
    assert r.status_code == 200
    req_id = r.json()["id"]

    # Patient approves
    msg = f"approve {req_id}"
    sig = _hex(sign(PATIENT.key.hex(), msg))
    r = requests.post(BASE + "/access/respond", json={
        "request_id": req_id, "patient_address": PATIENT.address,
        "signature": sig, "message": msg, "approve": True
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"

    # Now OTHER_DOCTOR can decrypt via grant
    msg2 = "decrypt v2"
    sig2 = _hex(sign(OTHER_DOCTOR.key.hex(), msg2))
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": OTHER_DOCTOR.address,
        "signature": sig2, "message": msg2
    })
    assert r.status_code == 200, r.text


# ---- LPA ----
def test_lpa_pending_enriched(record_id):
    r = requests.get(BASE + "/lpa/pending")
    assert r.status_code == 200
    items = r.json()
    assert any(x["record_id"] == record_id for x in items)
    sample = next(x for x in items if x["record_id"] == record_id)
    assert "patient_name" in sample and "diagnosis" in sample


def test_lpa_preview():
    r = requests.post(BASE + "/lpa/preview")
    assert r.status_code == 200
    j = r.json()
    assert "root" in j and "layers" in j
    assert j["count"] >= 1


def test_lpa_anchor_and_stats(record_id):
    msg = f"anchor {time.time()}"
    sig = _hex(sign(ADMIN_PK, msg))
    r = requests.post(BASE + "/lpa/anchor", json={
        "admin_address": ADMIN_ADDR, "signature": sig, "message": msg
    })
    assert r.status_code == 200, r.text
    anchor = r.json()
    assert anchor["root"].startswith("0x")
    assert anchor["tx_hash"].startswith("0x")
    assert isinstance(anchor["block_number"], int)

    # Record now anchored
    r = requests.get(BASE + f"/records/patient/{PATIENT.address}")
    rec = next(x for x in r.json() if x["id"] == record_id)
    assert rec["anchor_status"] == "anchored"
    assert rec["merkle_root"] == anchor["root"]

    # Anchors list
    r = requests.get(BASE + "/lpa/anchors")
    assert r.status_code == 200
    assert len(r.json()) >= 1

    # Stats
    r = requests.get(BASE + "/lpa/stats")
    j = r.json()
    assert j["anchors"] >= 1 and j["records"] >= 1


def test_lpa_anchor_rejects_non_admin():
    msg = "anchor attempt"
    sig = _hex(sign(DOCTOR.key.hex(), msg))
    r = requests.post(BASE + "/lpa/anchor", json={
        "admin_address": DOCTOR.address, "signature": sig, "message": msg
    })
    assert r.status_code in (400, 403)
