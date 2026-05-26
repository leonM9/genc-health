"""Tests for the Gen C verification certificate endpoints.

Covers /api/certificate/generate and /api/certificate/verify.

Flow under test: register patient + doctor, doctor uploads a record (pending),
admin anchors the LPA batch, then generate + verify certificate. Also covers
tamper detection and authorization edges.
"""
import os, hashlib, base64, io, time, uuid
import pytest, requests
from eth_account import Account
from eth_account.messages import encode_defunct
from conftest import resolve_backend_url, normalize_pk

BASE = resolve_backend_url() + "/api"

ADMIN_SEED = "genc-admin-thesis-deterministic-seed-2026"
ADMIN_PK = "0x" + hashlib.sha256(ADMIN_SEED.encode()).hexdigest()
ADMIN_ADDR = Account.from_key(ADMIN_PK).address

RUN_SUFFIX = uuid.uuid4().hex[:8]
DOCTOR = Account.from_key("0x" + hashlib.sha256(f"TEST_cert_doc_{RUN_SUFFIX}".encode()).hexdigest())
PATIENT = Account.from_key("0x" + hashlib.sha256(f"TEST_cert_pat_{RUN_SUFFIX}".encode()).hexdigest())
OTHER = Account.from_key("0x" + hashlib.sha256(f"TEST_cert_other_{RUN_SUFFIX}".encode()).hexdigest())


def _hex(s):
    return s if s.startswith("0x") else "0x" + s


def sign(pk, msg):
    """Robust signer — works with HexBytes, bytes, and prefixed/unprefixed hex strings."""
    pk_hex = normalize_pk(pk)
    sig = Account.sign_message(encode_defunct(text=msg), private_key=pk_hex).signature.hex()
    return sig if sig.startswith("0x") else "0x" + sig


def self_register(acct, role, name, department=None, hospital=None):
    msg = f"register {role} {acct.address} {time.time()}"
    payload = {
        "actor_address": acct.address, "actor_message": msg,
        "actor_signature": sign(acct.key.hex(), msg),
        "role": role, "name": name, "department": department, "hospital": hospital,
    }
    return requests.post(BASE + "/users/register", json=payload)


# ---- Session-scope autouse: ensures DOCTOR / PATIENT / OTHER are registered
# before any test in this file runs. Makes the file resilient to `-k` filters.
@pytest.fixture(scope="module", autouse=True)
def _ensure_cert_test_users():
    try:
        self_register(DOCTOR, "doctor", "Dr Cert", "Cardiology", "Cert Hospital")
        self_register(PATIENT, "patient", "Pat Cert")
        self_register(OTHER, "patient", "Other Pat")
    except Exception:
        pass
    yield


# ---- Shared fixtures: register + upload + anchor (module-scope, runs once) ----
@pytest.fixture(scope="module")
def pinata_cid():
    payload = b"TEST_CERT_" + uuid.uuid4().bytes
    files = {"file": ("blob.bin", io.BytesIO(payload), "application/octet-stream")}
    r = requests.post(BASE + "/ipfs/upload", files=files, timeout=120)
    assert r.status_code == 200, r.text
    return r.json()["cid"]


@pytest.fixture(scope="module")
def setup_users():
    assert self_register(DOCTOR, "doctor", "Dr Cert", "Cardiology", "Cert Hospital").status_code == 200
    assert self_register(PATIENT, "patient", "Pat Cert").status_code == 200
    assert self_register(OTHER, "patient", "Other Pat").status_code == 200
    return True


@pytest.fixture(scope="module")
def pending_record(setup_users, pinata_cid):
    msg = "upload record cert"
    enc_key = base64.b64encode(b"\x00" * 32).decode()
    policy = f"(Owner:{PATIENT.address.lower()})"
    payload = {
        "uploader_address": DOCTOR.address, "uploader_signature": sign(DOCTOR.key.hex(), msg),
        "uploader_message": msg, "patient_address": PATIENT.address, "cid": pinata_cid,
        "file_name": "cert_report.pdf", "file_size": 512, "encrypted_key_b64": enc_key,
        "policy": policy, "diagnosis": "Arrhythmia", "notes": "cert test",
    }
    r = requests.post(BASE + "/records", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["anchor_status"] == "pending"
    return body  # holds id + cid


# --- Certificate generation: pending record (must be 400 before anchor) ---
def test_certificate_generate_pending_record_returns_400(pending_record):
    msg = f"cert {time.time()}"
    r = requests.post(BASE + "/certificate/generate", json={
        "record_id": pending_record["id"], "requester_address": PATIENT.address,
        "signature": sign(PATIENT.key.hex(), msg), "message": msg,
    })
    assert r.status_code == 400, r.text


# --- Anchor LPA batch (so cert can be generated) ---
@pytest.fixture(scope="module")
def anchored_record(pending_record):
    msg = f"anchor cert {time.time()}"
    r = requests.post(BASE + "/lpa/anchor", json={
        "admin_address": ADMIN_ADDR, "signature": sign(ADMIN_PK, msg), "message": msg,
    })
    assert r.status_code == 200, r.text
    # Re-fetch the record to confirm anchored
    r = requests.get(BASE + f"/records/patient/{PATIENT.address}")
    rec = next(x for x in r.json() if x["id"] == pending_record["id"])
    assert rec["anchor_status"] == "anchored"
    assert rec.get("merkle_root", "").startswith("0x")
    return rec


# --- Certificate generation: happy path as patient ---
@pytest.fixture(scope="module")
def certificate(anchored_record):
    msg = f"cert {time.time()}"
    r = requests.post(BASE + "/certificate/generate", json={
        "record_id": anchored_record["id"], "requester_address": PATIENT.address,
        "signature": sign(PATIENT.key.hex(), msg), "message": msg,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_certificate_generate_patient_success(certificate, anchored_record):
    c = certificate
    assert c["kind"] == "GenC.MedicalRecordCertificate"
    assert c["version"]
    rec = c["record"]
    assert rec["cid"] == anchored_record["cid"]
    assert rec["leaf_hash"].startswith("0x") and len(rec["leaf_hash"]) == 66
    assert rec["merkle_root"] == anchored_record["merkle_root"]
    assert isinstance(rec["block_number"], int)
    assert rec["tx_hash"].startswith("0x")
    assert isinstance(c["merkle_proof"], list)
    for step in c["merkle_proof"]:
        assert "hash" in step and "position" in step
        assert step["position"] in ("left", "right")
        assert step["hash"].startswith("0x") and len(step["hash"]) == 66
    assert c["patient"]["did"].startswith("did:genc:patient:")
    assert c["provider"]["name"] == "Dr Cert"
    assert c["diagnosis"] == "Arrhythmia"


def test_certificate_generate_invalid_signature(anchored_record):
    msg = "cert hack"
    # Signature signed by DOCTOR but claiming PATIENT address
    bad_sig = sign(DOCTOR.key.hex(), msg)
    r = requests.post(BASE + "/certificate/generate", json={
        "record_id": anchored_record["id"], "requester_address": PATIENT.address,
        "signature": bad_sig, "message": msg,
    })
    assert r.status_code == 401, r.text


def test_certificate_generate_forbidden_non_owner(anchored_record):
    """A different patient (not record owner, not admin) cannot generate a certificate."""
    msg = f"cert {time.time()}"
    r = requests.post(BASE + "/certificate/generate", json={
        "record_id": anchored_record["id"], "requester_address": OTHER.address,
        "signature": sign(OTHER.key.hex(), msg), "message": msg,
    })
    assert r.status_code == 403, r.text


def test_certificate_generate_admin_path(anchored_record):
    """Admin can generate a certificate for any patient's record."""
    msg = f"admin cert {time.time()}"
    r = requests.post(BASE + "/certificate/generate", json={
        "record_id": anchored_record["id"], "requester_address": ADMIN_ADDR,
        "signature": sign(ADMIN_PK, msg), "message": msg,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["record"]["merkle_root"] == anchored_record["merkle_root"]


def test_certificate_generate_redactions(anchored_record):
    msg = f"cert redact {time.time()}"
    r = requests.post(BASE + "/certificate/generate", json={
        "record_id": anchored_record["id"], "requester_address": PATIENT.address,
        "signature": sign(PATIENT.key.hex(), msg), "message": msg,
        "redact_provider": True, "redact_diagnosis": True,
    })
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["provider"] == {"REDACTED": True}
    assert c["diagnosis"] == "REDACTED"


# ---- Certificate verification ----
def test_certificate_verify_valid(certificate):
    r = requests.post(BASE + "/certificate/verify", json={"certificate": certificate})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["valid"] is True
    assert body["anchor"]["merkle_root"] == certificate["record"]["merkle_root"]
    assert body["anchor"]["tx_hash"] == certificate["record"]["tx_hash"]
    assert body["anchor"]["block_number"] == certificate["record"]["block_number"]
    assert body["subject"]["diagnosis"] == certificate["diagnosis"]


def test_certificate_verify_tampered_root(certificate):
    import copy
    tampered = copy.deepcopy(certificate)
    root = tampered["record"]["merkle_root"]
    # Flip one byte in the middle of the hex string
    # Char at position 10 (within "0x..." hex); xor the nibble with 1
    pos = 10
    orig = root[pos]
    new_char = format(int(orig, 16) ^ 0x1, "x")
    tampered["record"]["merkle_root"] = root[:pos] + new_char + root[pos + 1:]
    r = requests.post(BASE + "/certificate/verify", json={"certificate": tampered})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    # Tampering with the claimed_root: either the recomputed root mismatches OR
    # the unknown root path fires - both are valid 'invalid' reasons.
    assert "reason" in body


def test_certificate_verify_tampered_leaf_hash(certificate):
    import copy
    tampered = copy.deepcopy(certificate)
    lh = tampered["record"]["leaf_hash"]
    pos = 10
    new_char = format(int(lh[pos], 16) ^ 0x1, "x")
    tampered["record"]["leaf_hash"] = lh[:pos] + new_char + lh[pos + 1:]
    r = requests.post(BASE + "/certificate/verify", json={"certificate": tampered})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert "leaf" in body.get("reason", "").lower()


def test_certificate_verify_unknown_anchor(certificate):
    """If we substitute a syntactically valid but never-anchored merkle_root,
    we expect valid=false (root not on chain). We construct a fake leaf+proof
    whose recomputed root is a value that was never anchored."""
    import copy
    from eth_utils import keccak
    fake_cid = "Qm" + uuid.uuid4().hex
    fake_leaf = "0x" + keccak(text=fake_cid).hex()
    # No proof => derived root == leaf_hash, which is almost certainly not on chain
    fake_cert = {
        "record": {
            "cid": fake_cid,
            "leaf_hash": fake_leaf,
            "merkle_root": fake_leaf,
            "block_number": 0,
            "tx_hash": "0x" + "0" * 64,
        },
        "merkle_proof": [],
        "diagnosis": "X",
        "patient": {"did": "did:genc:patient:fake"},
        "provider": {"name": "Fake"},
    }
    r = requests.post(BASE + "/certificate/verify", json={"certificate": fake_cert})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert "not found" in body.get("reason", "").lower() or "chain" in body.get("reason", "").lower()
