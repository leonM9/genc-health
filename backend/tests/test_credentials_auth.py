"""Tests for the new username/password credentials auth + demo-seed credentials.

Covers:
  • /api/auth/credentials/register — sig & PK validation, length checks, duplicate
  • /api/auth/credentials/login   — admin/admin123 happy path, wrong password 401
  • /api/auth/credentials/export-key — happy + wrong password 401
  • /api/auth/credentials/check/{username} — availability shape
  • /api/admin/seed-demo-scenario — returns username/password for each persona +
    every persona can log in via credentials_login + records carry label/category
  • POST /api/records — rejects missing/invalid label & category (400)
"""
import os
import time
import uuid
import hashlib
import pytest
import requests
from eth_account import Account

from conftest import resolve_backend_url, sign_message, make_account, ensure_user

BASE_URL = resolve_backend_url()

ADMIN_SEED = "genc-admin-thesis-deterministic-seed-2026"
ADMIN_PK = "0x" + hashlib.sha256(ADMIN_SEED.encode()).hexdigest()
ADMIN = Account.from_key(ADMIN_PK)


# ───────────────────────── helpers ─────────────────────────
def _new_wallet():
    pk = "0x" + hashlib.sha256(f"creds-test-{uuid.uuid4()}".encode()).hexdigest()
    return Account.from_key(pk), pk


def _register_wallet(acct, pk, username, password):
    msg = f"creds-register {acct.address} {time.time()}"
    sig = sign_message(pk, msg)
    return requests.post(f"{BASE_URL}/api/auth/credentials/register", json={
        "wallet_address": acct.address,
        "wallet_private_key": pk,
        "wallet_signature": sig,
        "wallet_message": msg,
        "username": username,
        "password": password,
    }, timeout=30)


# ───────────────────────── /credentials/check ─────────────────────────
class TestCredentialsCheck:
    def test_check_username_available(self):
        uname = f"test_avail_{uuid.uuid4().hex[:8]}"
        r = requests.get(f"{BASE_URL}/api/auth/credentials/check/{uname}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == uname.lower()
        assert data["available"] is True

    def test_check_admin_taken(self):
        # admin is auto-seeded on startup → must be unavailable
        r = requests.get(f"{BASE_URL}/api/auth/credentials/check/admin", timeout=15)
        assert r.status_code == 200
        assert r.json()["available"] is False


# ───────────────────────── /credentials/login admin ─────────────────────────
class TestAdminCredentialsLogin:
    def test_admin_login_success(self):
        r = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                          json={"username": "admin", "password": "admin123"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["username"] == "admin"
        assert data["role"] == "admin"
        assert data["address"].lower() == ADMIN.address.lower()
        assert data["wallet_private_key"].startswith("0x")
        # _id never leaked
        assert "_id" not in data

    def test_admin_login_wrong_password_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                          json={"username": "admin", "password": "wrong-password"}, timeout=15)
        assert r.status_code == 401

    def test_admin_login_unknown_user_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                          json={"username": f"nope_{uuid.uuid4().hex[:6]}", "password": "x" * 10},
                          timeout=15)
        assert r.status_code == 401


# ───────────────────────── /credentials/register ─────────────────────────
class TestCredentialsRegister:
    def test_register_then_login_roundtrip(self):
        acct, pk = _new_wallet()
        uname = f"u_{uuid.uuid4().hex[:8]}"
        pwd = "secret-pass-123"
        r = _register_wallet(acct, pk, uname, pwd)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["username"] == uname
        assert data["wallet_address"].lower() == acct.address.lower()
        # Now login with these credentials
        login = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                              json={"username": uname, "password": pwd}, timeout=15)
        assert login.status_code == 200
        ldata = login.json()
        assert ldata["wallet_private_key"] == pk
        assert ldata["address"].lower() == acct.address.lower()

    def test_register_duplicate_username_409(self):
        acct1, pk1 = _new_wallet()
        uname = f"dup_{uuid.uuid4().hex[:8]}"
        r1 = _register_wallet(acct1, pk1, uname, "passw0rd-aa")
        assert r1.status_code == 200
        acct2, pk2 = _new_wallet()
        r2 = _register_wallet(acct2, pk2, uname, "passw0rd-bb")
        assert r2.status_code == 409

    def test_register_short_password_400(self):
        acct, pk = _new_wallet()
        r = _register_wallet(acct, pk, f"shortpw_{uuid.uuid4().hex[:6]}", "abc")
        assert r.status_code == 400

    def test_register_pk_mismatch_400_bad_wallet(self):
        # Sign with one PK but advertise a different wallet address
        acct, pk = _new_wallet()
        other, _opk = _new_wallet()
        msg = f"creds-register {other.address} {time.time()}"
        sig = sign_message(pk, msg)  # not signed by `other`
        r = requests.post(f"{BASE_URL}/api/auth/credentials/register", json={
            "wallet_address": other.address,
            "wallet_private_key": pk,  # mismatched
            "wallet_signature": sig,
            "wallet_message": msg,
            "username": f"mm_{uuid.uuid4().hex[:6]}",
            "password": "passw0rd-ok",
        }, timeout=15)
        assert r.status_code == 401  # signature won't verify against `other`

    def test_register_invalid_signature_unauthorized(self):
        acct, pk = _new_wallet()
        msg = "creds-register tampered"
        # Sign a different message
        sig = sign_message(pk, "completely-different")
        r = requests.post(f"{BASE_URL}/api/auth/credentials/register", json={
            "wallet_address": acct.address,
            "wallet_private_key": pk,
            "wallet_signature": sig,
            "wallet_message": msg,
            "username": f"bad_{uuid.uuid4().hex[:6]}",
            "password": "passw0rd-ok",
        }, timeout=15)
        assert r.status_code == 401


# ───────────────────────── /credentials/export-key ─────────────────────────
class TestCredentialsExportKey:
    def test_export_key_success(self):
        acct, pk = _new_wallet()
        uname = f"exp_{uuid.uuid4().hex[:8]}"
        pwd = "exportable-pwd-1"
        assert _register_wallet(acct, pk, uname, pwd).status_code == 200
        r = requests.post(f"{BASE_URL}/api/auth/credentials/export-key",
                          json={"username": uname, "password": pwd}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["wallet_private_key"] == pk
        assert data["wallet_address"].lower() == acct.address.lower()

    def test_export_key_wrong_password_unauthorized_401(self):
        acct, pk = _new_wallet()
        uname = f"exp2_{uuid.uuid4().hex[:8]}"
        assert _register_wallet(acct, pk, uname, "right-password-9").status_code == 200
        r = requests.post(f"{BASE_URL}/api/auth/credentials/export-key",
                          json={"username": uname, "password": "WRONG-password"}, timeout=15)
        assert r.status_code == 401


# ───────────────────── /admin/seed-demo-scenario ─────────────────────
@pytest.fixture(scope="module")
def seed_demo_response():
    """Call seed once and reuse across all assertions to keep the test cheap."""
    msg = "seed-demo-scenario"
    sig = sign_message(ADMIN_PK, msg)
    r = requests.post(f"{BASE_URL}/api/admin/seed-demo-scenario", json={
        "admin_address": ADMIN.address, "message": msg, "signature": sig, "count": 0,
    }, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


class TestSeedDemoScenario:
    def test_seed_returns_2_doctors_with_credentials(self, seed_demo_response):
        docs = seed_demo_response.get("doctors") or seed_demo_response.get("doctors_out") or []
        assert len(docs) == 2
        usernames = sorted([d["username"] for d in docs])
        assert usernames == ["doctor1", "doctor2"]
        for d in docs:
            assert d["password"] == "doctor123"
            assert d["department"] in {"Cardiology", "Radiology"}

    def test_seed_returns_3_patients_with_credentials(self, seed_demo_response):
        pats = seed_demo_response.get("patients") or seed_demo_response.get("patients_out") or []
        assert len(pats) == 3
        usernames = sorted([p["username"] for p in pats])
        assert usernames == ["patient1", "patient2", "patient3"]
        for p in pats:
            assert p["password"] == "patient123"

    def test_seed_returns_5_records_with_label_and_category(self, seed_demo_response):
        recs = seed_demo_response.get("records") or []
        assert len(recs) == 5
        labels_seen = {r.get("label") or r.get("access_label") for r in recs}
        # Must include both Doctor Only and Patient Only labels
        assert labels_seen & {"Doctor Only"}
        assert labels_seen & {"Patient Only"}
        cats = {r.get("category") for r in recs}
        assert cats <= {"Cardiology", "Radiology", "Lab Results", "Immunization", "General",
                        "Neurology", "Imaging", "Prescription", "Laboratory"}
        assert len(cats) >= 3  # at least 3 distinct categories

    def test_doctor1_can_login_with_seeded_credentials(self, seed_demo_response):
        r = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                          json={"username": "doctor1", "password": "doctor123"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "doctor"
        assert (data.get("profile") or {}).get("department") == "Cardiology"

    def test_doctor2_specialty_is_radiology(self, seed_demo_response):
        r = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                          json={"username": "doctor2", "password": "doctor123"}, timeout=15)
        assert r.status_code == 200
        assert (r.json().get("profile") or {}).get("department") == "Radiology"

    def test_all_3_patients_can_login(self, seed_demo_response):
        for u in ["patient1", "patient2", "patient3"]:
            r = requests.post(f"{BASE_URL}/api/auth/credentials/login",
                              json={"username": u, "password": "patient123"}, timeout=15)
            assert r.status_code == 200, f"{u} login failed: {r.text}"
            assert r.json()["role"] == "patient"


# ───────────────── /records label & category enforcement ─────────────────
class TestRecordLabelCategoryEnforcement:
    """Doctor uploads a record; missing/invalid label or category must yield 400."""

    def _make_doctor_and_patient(self):
        suffix = uuid.uuid4().hex[:6]
        doc_acct, doc_pk = make_account(f"label-doc-{suffix}")
        pat_acct, pat_pk = make_account(f"label-pat-{suffix}")
        # Register directly using the hex PK (avoid ensure_user's buggy .key
        # path which fails on newer hexbytes versions).
        for acct, pk, role, name in [
            (doc_acct, doc_pk, "doctor", f"DocLbl {suffix}"),
            (pat_acct, pat_pk, "patient", f"PatLbl {suffix}"),
        ]:
            msg = f"register {role} {acct.address} {time.time()}"
            payload = {
                "actor_address": acct.address,
                "actor_message": msg,
                "actor_signature": sign_message(pk, msg),
                "role": role,
                "name": name,
                "department": "Cardiology" if role == "doctor" else None,
                "hospital": "LabelHosp" if role == "doctor" else None,
            }
            r = requests.post(f"{BASE_URL}/api/users/register", json=payload, timeout=30)
            assert r.status_code == 200, r.text
        return doc_acct, doc_pk, pat_acct

    def _upload_payload(self, doc_acct, doc_pk, pat_acct, *, label, category):
        msg = "upload-record"
        sig = sign_message(doc_pk, msg)
        return {
            "uploader_address": doc_acct.address,
            "uploader_signature": sig,
            "uploader_message": msg,
            "patient_address": pat_acct.address,
            "cid": f"Qm{uuid.uuid4().hex}",
            "wrapped_keys": {pat_acct.address.lower(): "dummy-wrapped"},
            "diagnosis": "Test diag",
            "notes": "n/a",
            "label": label,
            "category": category,
            "file_name": "test.bin",
            "file_size": 128,
            "encrypted_key_b64": "ZHVtbXk=",
            "policy": "doctor:Cardiology",
        }

    def test_record_invalid_label_400(self):
        doc, doc_pk, pat = self._make_doctor_and_patient()
        payload = self._upload_payload(doc, doc_pk, pat, label="Public", category="Cardiology")
        r = requests.post(f"{BASE_URL}/api/records", json=payload, timeout=15)
        assert r.status_code == 400
        assert "label" in r.text.lower()

    def test_record_invalid_category_400(self):
        doc, doc_pk, pat = self._make_doctor_and_patient()
        payload = self._upload_payload(doc, doc_pk, pat, label="Doctor Only", category="Astrology")
        r = requests.post(f"{BASE_URL}/api/records", json=payload, timeout=15)
        assert r.status_code == 400

    def test_record_valid_label_and_category_200(self):
        doc, doc_pk, pat = self._make_doctor_and_patient()
        payload = self._upload_payload(doc, doc_pk, pat, label="Patient Only", category="Cardiology")
        r = requests.post(f"{BASE_URL}/api/records", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["label"] == "Patient Only"
        assert body["category"] == "Cardiology"
