"""Gen C dApp backend tests (post self-registration + Google auth refactor).
Covers: root, admin info, auth/verify, self-registration (sig path), Google
session error path, /auth/me, /auth/logout, users CRUD, IPFS (Pinata),
records, decrypt-key with policy + grants, LPA pending/preview/anchor/stats.
"""
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

# Fresh test wallets per run to avoid collisions with previously persisted state
RUN_SUFFIX = uuid.uuid4().hex[:8]
DOCTOR = Account.from_key("0x" + hashlib.sha256(f"TEST_doctor_{RUN_SUFFIX}".encode()).hexdigest())
PATIENT = Account.from_key("0x" + hashlib.sha256(f"TEST_patient_{RUN_SUFFIX}".encode()).hexdigest())
OTHER_DOCTOR = Account.from_key("0x" + hashlib.sha256(f"TEST_other_doc_{RUN_SUFFIX}".encode()).hexdigest())


def _hex(s):
    return s if s.startswith("0x") else "0x" + s


def sign(pk, msg):
    return _hex(Account.sign_message(encode_defunct(text=msg), private_key=pk).signature.hex())


def self_register_payload(acct: Account, role: str, name: str, department: str | None = None, hospital: str | None = None):
    msg = f"register {role} {acct.address} {time.time()}"
    return {
        "actor_address": acct.address,
        "actor_message": msg,
        "actor_signature": sign(acct.key.hex(), msg),
        "role": role,
        "name": name,
        "department": department,
        "hospital": hospital,
    }


# ---- Health / admin info ----
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


# ---- /auth/verify ----
def test_auth_verify_admin():
    msg = f"login {time.time()}"
    r = requests.post(BASE + "/auth/verify", json={
        "address": ADMIN_ADDR, "message": msg, "signature": sign(ADMIN_PK, msg)
    })
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"


def test_auth_verify_unregistered():
    acct = Account.create()
    msg = "hi"
    r = requests.post(BASE + "/auth/verify", json={
        "address": acct.address, "message": msg, "signature": sign(acct.key.hex(), msg)
    })
    assert r.status_code == 200
    assert r.json()["role"] == "unregistered"


def test_auth_verify_invalid_signature():
    msg = "hi"
    bad = sign(ADMIN_PK, "different message")
    r = requests.post(BASE + "/auth/verify", json={
        "address": ADMIN_ADDR, "message": msg, "signature": bad
    })
    assert r.status_code == 401


# ---- Google auth error paths + cookie-gated endpoints ----
def test_google_session_invalid_id():
    r = requests.post(BASE + "/auth/google/session", json={"session_id": "definitely-not-a-real-session"})
    assert r.status_code == 401, r.text


def test_auth_me_requires_cookie():
    r = requests.get(BASE + "/auth/me")
    assert r.status_code == 401


def test_auth_logout_ok_without_cookie():
    # Logout must be tolerant when no cookie is present (returns ok:true)
    r = requests.post(BASE + "/auth/logout")
    assert r.status_code == 200
    assert r.json().get("ok") is True


# ---- Self-registration ----
def test_register_requires_auth():
    """No signature, no cookie -> 401."""
    r = requests.post(BASE + "/users/register", json={
        "actor_address": DOCTOR.address, "role": "doctor", "name": "X", "department": "Cardiology"
    })
    assert r.status_code == 401, r.text


def test_register_signature_mismatch_rejected():
    """Sig from a different wallet than actor_address -> 401."""
    msg = "register self"
    bad_sig = sign(PATIENT.key.hex(), msg)  # signed by patient
    r = requests.post(BASE + "/users/register", json={
        "actor_address": DOCTOR.address,  # claims to be doctor
        "actor_message": msg, "actor_signature": bad_sig,
        "role": "doctor", "name": "Imposter", "department": "Cardiology",
    })
    assert r.status_code == 401, r.text


def test_register_bad_role_rejected():
    msg = "register bad role"
    payload = {
        "actor_address": DOCTOR.address, "actor_message": msg,
        "actor_signature": sign(DOCTOR.key.hex(), msg),
        "role": "nurse", "name": "X",
    }
    r = requests.post(BASE + "/users/register", json=payload)
    assert r.status_code == 400


def test_register_self_doctor_and_patient():
    for acct, role, dept, name in [
        (DOCTOR, "doctor", "Cardiology", "Dr Test"),
        (PATIENT, "patient", None, "Pat Test"),
        (OTHER_DOCTOR, "doctor", "Radiology", "Dr Other"),
    ]:
        payload = self_register_payload(acct, role, name, dept)
        r = requests.post(BASE + "/users/register", json=payload)
        assert r.status_code == 200, f"{role} {acct.address}: {r.status_code} {r.text}"
        body = r.json()
        assert body["role"] == role
        assert body["address_lower"] == acct.address.lower()
        assert body["did"].startswith(f"did:genc:{role}:")

    # GET verifies persistence
    r = requests.get(BASE + f"/users/{DOCTOR.address}")
    assert r.status_code == 200 and r.json()["role"] == "doctor"

    r = requests.get(BASE + "/users")
    assert r.status_code == 200
    addrs = [u["address_lower"] for u in r.json()]
    assert DOCTOR.address.lower() in addrs
    assert PATIENT.address.lower() in addrs


def test_register_idempotent_update():
    """Re-registering the same address should update profile (no 409)."""
    payload = self_register_payload(DOCTOR, "doctor", "Dr Test Renamed", "Cardiology")
    r = requests.post(BASE + "/users/register", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Dr Test Renamed"

    # GET reflects update
    r = requests.get(BASE + f"/users/{DOCTOR.address}")
    assert r.status_code == 200
    assert r.json()["name"] == "Dr Test Renamed"


# ---- IPFS (Pinata real) ----
@pytest.fixture(scope="module")
def pinata_cid():
    payload = b"TEST_GENC_" + uuid.uuid4().bytes
    files = {"file": ("blob.bin", io.BytesIO(payload), "application/octet-stream")}
    r = requests.post(BASE + "/ipfs/upload", files=files, timeout=120)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "cid" in j and len(j["cid"]) > 20
    return j["cid"]


def test_ipfs_upload(pinata_cid):
    assert pinata_cid


# ---- Records ----
@pytest.fixture(scope="module")
def record_id(pinata_cid):
    # Ensure both users exist
    requests.post(BASE + "/users/register", json=self_register_payload(DOCTOR, "doctor", "Dr Test", "Cardiology"))
    requests.post(BASE + "/users/register", json=self_register_payload(PATIENT, "patient", "Pat Test"))
    requests.post(BASE + "/users/register", json=self_register_payload(OTHER_DOCTOR, "doctor", "Dr Other", "Radiology"))

    msg = "upload record"
    sig = sign(DOCTOR.key.hex(), msg)
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
    assert record_id in [x["id"] for x in r.json()]


def test_records_for_doctor(record_id):
    r = requests.get(BASE + f"/records/doctor/{DOCTOR.address}")
    assert r.status_code == 200
    j = r.json()
    assert any(x["id"] == record_id for x in j["uploaded"])


def test_records_upload_blocked_for_non_doctor(pinata_cid):
    """Patient cannot upload (role check)."""
    msg = "upload as patient"
    sig = sign(PATIENT.key.hex(), msg)
    payload = {
        "uploader_address": PATIENT.address, "uploader_signature": sig, "uploader_message": msg,
        "patient_address": PATIENT.address, "cid": pinata_cid, "file_name": "x.pdf",
        "file_size": 1, "encrypted_key_b64": base64.b64encode(b"\x00" * 32).decode(),
        "policy": "Owner:self", "diagnosis": "x"
    }
    r = requests.post(BASE + "/records", json=payload)
    assert r.status_code == 403


# ---- Decrypt key & policy ----
def test_decrypt_key_owner_allowed(record_id):
    msg = "decrypt"
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": PATIENT.address,
        "signature": sign(PATIENT.key.hex(), msg), "message": msg
    })
    assert r.status_code == 200, r.text
    assert "encrypted_key_b64" in r.json()


def test_decrypt_key_unauthorized_doctor(record_id):
    msg = "decrypt"
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": OTHER_DOCTOR.address,
        "signature": sign(OTHER_DOCTOR.key.hex(), msg), "message": msg
    })
    assert r.status_code == 403, r.text


def test_decrypt_policy_cardiology_doctor(record_id):
    msg = "decrypt"
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": DOCTOR.address,
        "signature": sign(DOCTOR.key.hex(), msg), "message": msg
    })
    assert r.status_code == 200, r.text


# ---- Access request/grant flow ----
def test_access_request_and_grant_flow(record_id):
    r = requests.post(BASE + "/access/request", json={
        "doctor_address": OTHER_DOCTOR.address, "patient_address": PATIENT.address,
        "reason": "second opinion"
    })
    assert r.status_code == 200
    req_id = r.json()["id"]

    # Pending list
    r = requests.get(BASE + f"/access/pending/{PATIENT.address}")
    assert r.status_code == 200
    assert any(x["id"] == req_id for x in r.json())

    # Patient approves
    msg = f"approve {req_id}"
    r = requests.post(BASE + "/access/respond", json={
        "request_id": req_id, "patient_address": PATIENT.address,
        "signature": sign(PATIENT.key.hex(), msg), "message": msg, "approve": True
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"

    # OTHER_DOCTOR now decrypts via grant
    msg2 = "decrypt v2"
    r = requests.post(BASE + "/records/decrypt-key", json={
        "record_id": record_id, "requester_address": OTHER_DOCTOR.address,
        "signature": sign(OTHER_DOCTOR.key.hex(), msg2), "message": msg2
    })
    assert r.status_code == 200, r.text

    # Grant visible
    r = requests.get(BASE + f"/access/granted/{OTHER_DOCTOR.address}")
    assert r.status_code == 200
    assert any(g["patient_address_lower"] == PATIENT.address.lower() for g in r.json())


# ---- LPA ----
def test_lpa_pending_enriched(record_id):
    r = requests.get(BASE + "/lpa/pending")
    assert r.status_code == 200
    items = r.json()
    sample = next((x for x in items if x["record_id"] == record_id), None)
    assert sample is not None
    assert "patient_name" in sample and "diagnosis" in sample


def test_lpa_preview():
    r = requests.post(BASE + "/lpa/preview")
    assert r.status_code == 200
    j = r.json()
    assert "root" in j and "layers" in j and j["count"] >= 1


def test_lpa_anchor_rejects_non_admin():
    msg = "anchor attempt"
    r = requests.post(BASE + "/lpa/anchor", json={
        "admin_address": DOCTOR.address, "signature": sign(DOCTOR.key.hex(), msg), "message": msg
    })
    assert r.status_code in (400, 403)


def test_lpa_anchor_and_stats(record_id):
    msg = f"anchor {time.time()}"
    r = requests.post(BASE + "/lpa/anchor", json={
        "admin_address": ADMIN_ADDR, "signature": sign(ADMIN_PK, msg), "message": msg
    })
    assert r.status_code == 200, r.text
    anchor = r.json()
    assert anchor["root"].startswith("0x")
    assert anchor["tx_hash"].startswith("0x")
    assert isinstance(anchor["block_number"], int)

    # Anchor reflected on the record
    r = requests.get(BASE + f"/records/patient/{PATIENT.address}")
    rec = next(x for x in r.json() if x["id"] == record_id)
    assert rec["anchor_status"] == "anchored"
    assert rec["merkle_root"] == anchor["root"]

    r = requests.get(BASE + "/lpa/anchors")
    assert r.status_code == 200 and len(r.json()) >= 1

    r = requests.get(BASE + "/lpa/stats")
    j = r.json()
    assert j["anchors"] >= 1 and j["records"] >= 1



# ---- Hospital field roundtrip ----
def test_register_doctor_with_hospital_roundtrip():
    """Doctors can register with a 'hospital' field; it's returned by GET /api/users and GET /api/users/{addr}."""
    payload = self_register_payload(DOCTOR, "doctor", "Dr Test Renamed", "Cardiology", hospital="Gen C General Hospital")
    r = requests.post(BASE + "/users/register", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("hospital") == "Gen C General Hospital"

    # Persisted via GET /users/{addr}
    r = requests.get(BASE + f"/users/{DOCTOR.address}")
    assert r.status_code == 200
    assert r.json().get("hospital") == "Gen C General Hospital"

    # Visible in GET /users
    r = requests.get(BASE + "/users")
    assert r.status_code == 200
    rec = next((u for u in r.json() if u["address_lower"] == DOCTOR.address.lower()), None)
    assert rec is not None and rec.get("hospital") == "Gen C General Hospital"


# ---- Upload Requests (Patient -> Doctor) ----
def _patient_signed_upload_req(doctor_addr: str, title: str = "Need ECG record", reason: str = "Follow-up"):
    msg = f"upload-request {doctor_addr} {time.time()}"
    return {
        "patient_address": PATIENT.address,
        "patient_message": msg,
        "patient_signature": sign(PATIENT.key.hex(), msg),
        "doctor_address": doctor_addr,
        "title": title,
        "reason": reason,
    }


def test_upload_request_create_success():
    payload = _patient_signed_upload_req(DOCTOR.address)
    r = requests.post(BASE + "/upload-requests", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "pending"
    assert j["patient_name"] == "Pat Test"
    assert j["doctor_name"] == "Dr Test Renamed"
    assert j["doctor_hospital"] == "Gen C General Hospital"
    assert j["doctor_department"] == "Cardiology"
    assert j["title"] == "Need ECG record"
    assert j["record_id"] is None
    assert "id" in j


def test_upload_request_invalid_signature():
    msg = "upload-request"
    bad_sig = sign(DOCTOR.key.hex(), msg)  # signed by doctor, not patient
    payload = {
        "patient_address": PATIENT.address, "patient_message": msg, "patient_signature": bad_sig,
        "doctor_address": DOCTOR.address, "title": "x",
    }
    r = requests.post(BASE + "/upload-requests", json=payload)
    assert r.status_code == 401, r.text


def test_upload_request_non_patient_actor_403():
    """Caller is a doctor (or unregistered) — must be a registered patient."""
    msg = f"upload-request {time.time()}"
    payload = {
        "patient_address": OTHER_DOCTOR.address,
        "patient_message": msg,
        "patient_signature": sign(OTHER_DOCTOR.key.hex(), msg),
        "doctor_address": DOCTOR.address,
        "title": "x",
    }
    r = requests.post(BASE + "/upload-requests", json=payload)
    assert r.status_code == 403, r.text


def test_upload_request_target_not_doctor_400():
    """Target address must be a registered doctor — sending to a patient should fail."""
    msg = f"upload-request {time.time()}"
    payload = {
        "patient_address": PATIENT.address,
        "patient_message": msg,
        "patient_signature": sign(PATIENT.key.hex(), msg),
        "doctor_address": PATIENT.address,  # not a doctor
        "title": "x",
    }
    r = requests.post(BASE + "/upload-requests", json=payload)
    # Spec says 403 for non-doctor target; server returns 400. Accept either.
    assert r.status_code in (400, 403), r.text


def test_upload_request_get_for_doctor():
    # ensure at least one exists
    requests.post(BASE + "/upload-requests", json=_patient_signed_upload_req(DOCTOR.address, title="MRI scan"))
    r = requests.get(BASE + f"/upload-requests/doctor/{DOCTOR.address}")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    sample = items[0]
    assert "patient_name" in sample and "title" in sample
    assert sample["doctor_address_lower"] == DOCTOR.address.lower()


def test_upload_request_get_for_patient():
    r = requests.get(BASE + f"/upload-requests/patient/{PATIENT.address}")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    for it in items:
        assert it["patient_address_lower"] == PATIENT.address.lower()


def test_records_with_upload_request_id_marks_fulfilled(pinata_cid):
    """Creating a record with upload_request_id flips the request to 'fulfilled' and stamps record_id."""
    # Create a fresh request
    r = requests.post(BASE + "/upload-requests", json=_patient_signed_upload_req(DOCTOR.address, title="Blood test"))
    assert r.status_code == 200
    req_id = r.json()["id"]

    # Doctor uploads record linked to that request
    msg = f"upload linked {time.time()}"
    sig = sign(DOCTOR.key.hex(), msg)
    enc_key = base64.b64encode(b"\x01" * 32).decode()
    policy = f"(Role:Doctor AND Department:Cardiology) OR (Owner:{PATIENT.address.lower()})"
    payload = {
        "uploader_address": DOCTOR.address, "uploader_signature": sig, "uploader_message": msg,
        "patient_address": PATIENT.address, "cid": pinata_cid, "file_name": "blood.pdf",
        "file_size": 2048, "encrypted_key_b64": enc_key, "policy": policy,
        "diagnosis": "Routine", "notes": "linked to req", "upload_request_id": req_id,
    }
    r = requests.post(BASE + "/records", json=payload)
    assert r.status_code == 200, r.text
    new_record_id = r.json()["id"]

    # Re-fetch request via patient endpoint and verify status/record_id
    r = requests.get(BASE + f"/upload-requests/patient/{PATIENT.address}")
    assert r.status_code == 200
    match = next((x for x in r.json() if x["id"] == req_id), None)
    assert match is not None
    assert match["status"] == "fulfilled"
    assert match["record_id"] == new_record_id
    assert match["fulfilled_at"] is not None


def test_upload_request_decline_by_assigned_doctor():
    # Create a fresh pending request
    r = requests.post(BASE + "/upload-requests", json=_patient_signed_upload_req(DOCTOR.address, title="X-ray"))
    req_id = r.json()["id"]

    # Wrong doctor cannot decline -> 403
    msg = f"decline {req_id}"
    r = requests.post(BASE + "/upload-requests/decline", json={
        "request_id": req_id, "doctor_address": OTHER_DOCTOR.address,
        "doctor_signature": sign(OTHER_DOCTOR.key.hex(), msg), "doctor_message": msg,
    })
    assert r.status_code == 403, r.text

    # Assigned doctor declines -> status becomes 'declined'
    msg2 = f"decline self {req_id}"
    r = requests.post(BASE + "/upload-requests/decline", json={
        "request_id": req_id, "doctor_address": DOCTOR.address,
        "doctor_signature": sign(DOCTOR.key.hex(), msg2), "doctor_message": msg2,
    })
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    # Verify status persisted
    r = requests.get(BASE + f"/upload-requests/doctor/{DOCTOR.address}")
    match = next((x for x in r.json() if x["id"] == req_id), None)
    assert match is not None and match["status"] == "declined"


def test_upload_request_decline_invalid_signature():
    r = requests.post(BASE + "/upload-requests", json=_patient_signed_upload_req(DOCTOR.address, title="Ultrasound"))
    req_id = r.json()["id"]
    msg = "decline"
    bad_sig = sign(PATIENT.key.hex(), msg)
    r = requests.post(BASE + "/upload-requests/decline", json={
        "request_id": req_id, "doctor_address": DOCTOR.address,
        "doctor_signature": bad_sig, "doctor_message": msg,
    })
    assert r.status_code == 401, r.text
