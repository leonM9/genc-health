"""
Gen C dApp Backend
Decentralized Medical Records (Privacy by Design, RA 10173)
Hybrid Encryption (AES-256 + simulated CP-ABE) + LPA Merkle Anchoring
"""
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Request, Response, Cookie
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, hashlib, json, io, re
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone
import requests
from eth_account import Account
from eth_account.messages import encode_defunct

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
PINATA_JWT = os.environ.get("PINATA_JWT", "")
PINATA_GATEWAY = os.environ.get("PINATA_GATEWAY", "https://gateway.pinata.cloud/ipfs")
ADMIN_SEED = os.environ.get("ADMIN_SEED", "genc-admin")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Gen C dApp")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("genc")


# ---------- Utilities ----------
def utcnow():
    return datetime.now(timezone.utc).isoformat()


def keccak_hex(data: bytes) -> str:
    """Ethereum-style keccak256 via web3-compatible hashing (eth_utils not needed)."""
    from eth_utils import keccak
    return "0x" + keccak(data).hex()


def derive_admin_address(seed: str) -> Dict[str, str]:
    """Deterministically derive an admin Ethereum keypair from seed."""
    pk_bytes = hashlib.sha256(seed.encode()).digest()
    acct = Account.from_key(pk_bytes)
    return {
        "address": acct.address,
        "private_key": "0x" + pk_bytes.hex(),
    }


ADMIN = derive_admin_address(ADMIN_SEED)
log.info(f"Admin wallet derived: {ADMIN['address']}")


def verify_sig(address: str, message: str, signature: str) -> bool:
    """Verify an Ethereum personal_sign signature."""
    try:
        msg = encode_defunct(text=message)
        recovered = Account.recover_message(msg, signature=signature)
        return recovered.lower() == address.lower()
    except Exception as e:
        log.warning(f"sig verify fail: {e}")
        return False


def addr_norm(a: str) -> str:
    return (a or "").lower()


def build_merkle(leaves: List[str]) -> Dict[str, Any]:
    """Simple keccak256-based Merkle tree. Returns {root, layers}."""
    from eth_utils import keccak
    if not leaves:
        return {"root": "0x" + ("0" * 64), "layers": []}
    layer = [keccak(text=lf).hex() for lf in leaves]
    layers = [layer[:]]
    while len(layer) > 1:
        nxt = []
        for i in range(0, len(layer), 2):
            a = layer[i]
            b = layer[i + 1] if i + 1 < len(layer) else layer[i]
            pair = bytes.fromhex(a) + bytes.fromhex(b)
            nxt.append(keccak(pair).hex())
        layer = nxt
        layers.append(layer[:])
    return {"root": "0x" + layer[0], "layers": [["0x" + n for n in lay] for lay in layers]}


# ---------- Models ----------
class SigPayload(BaseModel):
    address: str
    message: str
    signature: str


class UserRegister(BaseModel):
    """Self-registration. User signs with their OWN wallet (or session cookie)."""
    actor_address: str
    actor_signature: Optional[str] = None
    actor_message: Optional[str] = None
    role: str  # 'doctor' | 'patient'
    name: str
    department: Optional[str] = None
    hospital: Optional[str] = None
    did: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class RecordCreate(BaseModel):
    uploader_address: str
    uploader_signature: str
    uploader_message: str
    patient_address: str
    cid: str
    file_name: str
    file_size: int
    encrypted_key_b64: str  # AES key, server stores; release governed by CP-ABE policy
    policy: str
    diagnosis: str
    notes: Optional[str] = ""
    upload_request_id: Optional[str] = None  # optional link to a patient's request


class AccessRequest(BaseModel):
    doctor_address: str
    patient_address: str
    reason: Optional[str] = ""


class AccessRespond(BaseModel):
    request_id: str
    patient_address: str
    signature: str
    message: str
    approve: bool


class DecryptKeyReq(BaseModel):
    record_id: str
    requester_address: str
    signature: str
    message: str


# ---------- Google Auth Session Helper ----------
SESSION_TTL_DAYS = 7

def derive_user_wallet(google_sub: str) -> Dict[str, str]:
    """Deterministic Ethereum wallet from Google sub + server seed."""
    pk_bytes = hashlib.sha256(("genc-user::" + ADMIN_SEED + "::" + google_sub).encode()).digest()
    acct = Account.from_key(pk_bytes)
    return {"address": acct.address, "private_key": "0x" + pk_bytes.hex()}


async def _session_user(session_token: str) -> Optional[Dict[str, Any]]:
    if not session_token:
        return None
    sess = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
    if not sess:
        return None
    exp = sess.get("expires_at")
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        return None
    return sess


async def _require_session(request: Request) -> Dict[str, Any]:
    token = request.cookies.get("session_token") or request.headers.get("authorization", "").replace("Bearer ", "").strip()
    sess = await _session_user(token)
    if not sess:
        raise HTTPException(401, "Not authenticated")
    return sess


# ---------- Auth & Users ----------
@api.get("/")
async def root():
    return {"name": "Gen C dApp", "ok": True, "admin_address": ADMIN["address"]}


@api.get("/admin/info")
async def admin_info():
    """Expose deterministic admin info for thesis demo (address + private key)."""
    return {
        "address": ADMIN["address"],
        "private_key": ADMIN["private_key"],
        "note": "Deterministic admin generated from ADMIN_SEED. Demo only.",
    }


@api.post("/auth/verify")
async def auth_verify(p: SigPayload):
    if not verify_sig(p.address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    addr = addr_norm(p.address)
    # Admin?
    if addr == ADMIN["address"].lower():
        return {
            "address": p.address,
            "role": "admin",
            "profile": {"name": "System Administrator", "did": "did:genc:admin"},
        }
    user = await db.users.find_one({"address_lower": addr}, {"_id": 0})
    if not user:
        return {"address": p.address, "role": "unregistered", "profile": None}
    return {"address": p.address, "role": user["role"], "profile": user}


# ---------- Google Auth Endpoints ----------
class GoogleSessionReq(BaseModel):
    session_id: str


@api.post("/auth/google/session")
async def google_session_exchange(body: GoogleSessionReq, response: Response):
    """Exchange the OAuth session_id for our own session_token cookie."""
    try:
        r = requests.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        raise HTTPException(401, f"OAuth exchange failed: {e}")
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    google_sub = data.get("id") or email
    if not email:
        raise HTTPException(400, "OAuth response missing email")

    # Derive deterministic wallet for this Google identity
    wallet = derive_user_wallet(google_sub)

    # Upsert auth_user record
    existing = await db.auth_users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.auth_users.update_one(
            {"email": email},
            {"$set": {
                "name": name,
                "picture": picture,
                "google_sub": google_sub,
                "wallet_address": wallet["address"],
                "wallet_private_key": wallet["private_key"],
                "updated_at": utcnow(),
            }},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.auth_users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "google_sub": google_sub,
            "wallet_address": wallet["address"],
            "wallet_private_key": wallet["private_key"],
            "created_at": utcnow(),
        })

    session_token = data.get("session_token") or uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc).replace(microsecond=0)
    from datetime import timedelta
    expires_at = expires_at + timedelta(days=SESSION_TTL_DAYS)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "email": email,
        "wallet_address": wallet["address"],
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })

    # Cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )

    # Check if there's a registered Gen C profile for this wallet
    profile = await db.users.find_one({"address_lower": wallet["address"].lower()}, {"_id": 0})
    role = profile["role"] if profile else "unregistered"

    return {
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": picture,
        "wallet": wallet,  # Includes private_key for client-side signing
        "session_token": session_token,
        "role": role,
        "profile": profile,
    }


@api.get("/auth/me")
async def auth_me(request: Request):
    sess = await _require_session(request)
    user = await db.auth_users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    profile = await db.users.find_one({"address_lower": user["wallet_address"].lower()}, {"_id": 0})
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture"),
        "wallet": {"address": user["wallet_address"], "private_key": user["wallet_private_key"]},
        "role": profile["role"] if profile else "unregistered",
        "profile": profile,
    }


@api.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api.post("/users/register")
async def users_register(p: UserRegister, request: Request):
    """Self-registration. Caller proves ownership of actor_address via
    EITHER (a) signature over actor_message, OR (b) a valid Google session cookie."""
    if p.role not in ("doctor", "patient"):
        raise HTTPException(400, "role must be doctor or patient")
    addr = addr_norm(p.actor_address)
    if not addr:
        raise HTTPException(400, "actor_address required")

    # Path A: signature
    sig_ok = bool(p.actor_signature and p.actor_message and verify_sig(p.actor_address, p.actor_message, p.actor_signature))
    # Path B: session cookie tied to this address
    session_ok = False
    if not sig_ok:
        token = request.cookies.get("session_token") or request.headers.get("authorization", "").replace("Bearer ", "").strip()
        if token:
            sess = await _session_user(token)
            if sess and addr_norm(sess.get("wallet_address")) == addr:
                session_ok = True
    if not (sig_ok or session_ok):
        raise HTTPException(401, "Must sign with the wallet OR present a valid Google session")
    return await _upsert_user(p, addr)


async def _upsert_user(p, addr: str):
    exists = await db.users.find_one({"address_lower": addr})
    if exists:
        await db.users.update_one(
            {"address_lower": addr},
            {"$set": {
                "role": p.role,
                "name": p.name,
                "department": p.department,
                "hospital": p.hospital,
                "did": p.did or exists.get("did"),
                "updated_at": utcnow(),
            }},
        )
        u = await db.users.find_one({"address_lower": addr}, {"_id": 0})
        return u
    did = p.did or f"did:genc:{p.role}:{addr[2:10]}"
    doc = {
        "id": str(uuid.uuid4()),
        "address": p.actor_address,
        "address_lower": addr,
        "role": p.role,
        "name": p.name,
        "department": p.department,
        "hospital": p.hospital,
        "did": did,
        "extra": p.extra or {},
        "created_at": utcnow(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    return doc


class AdminRegister(BaseModel):
    """Admin registers a user on behalf — for in-clinic onboarding flows."""
    admin_address: str
    admin_signature: str
    admin_message: str
    target_address: str  # the wallet that will own this profile
    role: str
    name: str
    department: Optional[str] = None
    hospital: Optional[str] = None
    did: Optional[str] = None


@api.post("/users/admin-register")
async def users_admin_register(p: AdminRegister):
    """Admin-initiated registration. The admin signs a message; we trust the
    admin to enter the patient/doctor's wallet address."""
    if not verify_sig(p.admin_address, p.admin_message, p.admin_signature):
        raise HTTPException(401, "Invalid admin signature")
    if addr_norm(p.admin_address) != ADMIN["address"].lower():
        raise HTTPException(403, "Only admin can use this endpoint")
    if p.role not in ("doctor", "patient"):
        raise HTTPException(400, "role must be doctor or patient")
    addr = addr_norm(p.target_address)
    if not addr or not addr.startswith("0x") or len(addr) != 42:
        raise HTTPException(400, "Invalid target wallet address")
    # Mock the UserRegister-shaped object for _upsert_user
    class _P:
        pass
    fake = _P()
    fake.actor_address = p.target_address
    fake.role = p.role
    fake.name = p.name
    fake.department = p.department
    fake.hospital = p.hospital
    fake.did = p.did
    fake.extra = {"admin_registered": True}
    return await _upsert_user(fake, addr)


@api.get("/users")
async def users_list():
    items = await db.users.find({}, {"_id": 0}).to_list(1000)
    return items


@api.get("/users/{address}")
async def users_get(address: str):
    if address.lower() == ADMIN["address"].lower():
        return {"address": ADMIN["address"], "role": "admin", "name": "System Administrator", "did": "did:genc:admin"}
    u = await db.users.find_one({"address_lower": address.lower()}, {"_id": 0})
    if not u:
        raise HTTPException(404, "Not found")
    return u


# ---------- IPFS via Pinata ----------
@api.post("/ipfs/upload")
async def ipfs_upload(file: UploadFile = File(...)):
    """Pin an encrypted blob to Pinata. Returns CID."""
    if not PINATA_JWT:
        # Fallback: local sha-based CID
        data = await file.read()
        h = hashlib.sha256(data).hexdigest()
        fake_cid = "bafk" + h[:50]
        await db.ipfs_local.insert_one({"cid": fake_cid, "size": len(data), "name": file.filename, "ts": utcnow()})
        return {"cid": fake_cid, "size": len(data), "fallback": True}
    data = await file.read()
    files = {"file": (file.filename, io.BytesIO(data), file.content_type or "application/octet-stream")}
    headers = {"Authorization": f"Bearer {PINATA_JWT}"}
    try:
        r = requests.post(
            "https://api.pinata.cloud/pinning/pinFileToIPFS",
            files=files,
            headers=headers,
            timeout=60,
        )
        r.raise_for_status()
        j = r.json()
        return {"cid": j["IpfsHash"], "size": j.get("PinSize", len(data)), "fallback": False}
    except Exception as e:
        log.error(f"Pinata upload failed: {e}")
        raise HTTPException(502, f"IPFS upload failed: {e}")


@api.get("/ipfs/gateway/{cid}")
async def ipfs_gateway(cid: str):
    """Return gateway URL (avoid CORS by streaming through backend)."""
    try:
        r = requests.get(f"{PINATA_GATEWAY}/{cid}", timeout=60)
        r.raise_for_status()
        from fastapi.responses import Response
        return Response(content=r.content, media_type="application/octet-stream")
    except Exception as e:
        raise HTTPException(404, f"Fetch failed: {e}")


# ---------- Medical Records ----------
@api.post("/records")
async def records_create(p: RecordCreate):
    if not verify_sig(p.uploader_address, p.uploader_message, p.uploader_signature):
        raise HTTPException(401, "Invalid uploader signature")
    uploader = await db.users.find_one({"address_lower": addr_norm(p.uploader_address)}, {"_id": 0})
    is_admin = addr_norm(p.uploader_address) == ADMIN["address"].lower()
    if not is_admin and (not uploader or uploader["role"] != "doctor"):
        raise HTTPException(403, "Only registered doctors or admin can upload records")
    patient = await db.users.find_one({"address_lower": addr_norm(p.patient_address)}, {"_id": 0})
    if not patient or patient["role"] != "patient":
        raise HTTPException(400, "Target patient not registered")
    uploader_name = uploader["name"] if uploader else "System Administrator"
    uploader_department = (uploader.get("department") if uploader else "Admin") or "Admin"
    rec = {
        "id": str(uuid.uuid4()),
        "cid": p.cid,
        "file_name": p.file_name,
        "file_size": p.file_size,
        "encrypted_key_b64": p.encrypted_key_b64,
        "policy": p.policy,
        "diagnosis": p.diagnosis,
        "notes": p.notes,
        "uploader_address": p.uploader_address,
        "uploader_address_lower": addr_norm(p.uploader_address),
        "uploader_name": uploader_name,
        "uploader_department": uploader_department,
        "uploader_role": "admin" if is_admin else "doctor",
        "patient_address": p.patient_address,
        "patient_address_lower": addr_norm(p.patient_address),
        "patient_name": patient["name"],
        "created_at": utcnow(),
        "anchor_status": "pending",
        "merkle_root": None,
        "anchor_tx": None,
        "anchor_block": None,
    }
    await db.records.insert_one(rec)
    # Enqueue to LPA pending batch
    await db.lpa_pending.insert_one({
        "id": str(uuid.uuid4()),
        "record_id": rec["id"],
        "cid": rec["cid"],
        "added_at": utcnow(),
    })
    # If linked to an upload request, mark it fulfilled
    if p.upload_request_id:
        await db.upload_requests.update_one(
            {"id": p.upload_request_id, "doctor_address_lower": addr_norm(p.uploader_address)},
            {"$set": {"status": "fulfilled", "fulfilled_at": utcnow(), "record_id": rec["id"]}},
        )
    rec.pop("_id", None)
    return rec


@api.get("/records/patient/{address}")
async def records_for_patient(address: str):
    items = await db.records.find({"patient_address_lower": address.lower()}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api.get("/records/doctor/{address}")
async def records_for_doctor(address: str):
    """Records uploaded by this doctor OR ones they have approved access to."""
    addr = address.lower()
    own = await db.records.find({"uploader_address_lower": addr}, {"_id": 0}).sort("created_at", -1).to_list(500)
    grants = await db.access_grants.find({"doctor_address_lower": addr, "status": "approved"}, {"_id": 0}).to_list(500)
    patient_addrs = list({g["patient_address_lower"] for g in grants})
    accessible = []
    if patient_addrs:
        accessible = await db.records.find(
            {"patient_address_lower": {"$in": patient_addrs}, "uploader_address_lower": {"$ne": addr}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(500)
    return {"uploaded": own, "accessible": accessible, "grants": grants}


@api.post("/records/decrypt-key")
async def decrypt_key(p: DecryptKeyReq):
    """Simulated CP-ABE: verify requester satisfies policy then release AES key."""
    if not verify_sig(p.requester_address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    rec = await db.records.find_one({"id": p.record_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Record not found")
    req_addr = addr_norm(p.requester_address)
    # Build attribute set for requester
    requester_user = await db.users.find_one({"address_lower": req_addr}, {"_id": 0})
    attrs = {"address": req_addr, "is_owner": req_addr == rec["patient_address_lower"]}
    if requester_user:
        attrs["role"] = requester_user["role"]
        attrs["department"] = (requester_user.get("department") or "").lower()
        attrs["did"] = requester_user.get("did")
    # Policy evaluation
    allowed, reason = evaluate_policy(rec["policy"], attrs, rec)
    if not allowed:
        # Check access grants for doctors
        if attrs.get("role") == "doctor":
            grant = await db.access_grants.find_one({
                "doctor_address_lower": req_addr,
                "patient_address_lower": rec["patient_address_lower"],
                "status": "approved",
            })
            if grant:
                allowed = True
                reason = "Granted via patient signature"
    if not allowed:
        raise HTTPException(403, f"Policy not satisfied: {reason}")
    return {
        "record_id": rec["id"],
        "encrypted_key_b64": rec["encrypted_key_b64"],
        "policy": rec["policy"],
        "decision_reason": reason,
        "attributes_used": attrs,
    }


def evaluate_policy(policy: str, attrs: Dict[str, Any], rec: Dict[str, Any]) -> (bool, str):
    """Evaluate a CP-ABE-like policy string.

    Supported syntax (simulated):
        (Role:Doctor AND Department:Cardiology) OR (Owner:0xabc...)
    """
    if not policy:
        return False, "Empty policy"

    def check_atom(atom: str) -> bool:
        atom = atom.strip()
        if ":" not in atom:
            return False
        k, v = atom.split(":", 1)
        k = k.strip().lower()
        v = v.strip().lower()
        if k == "role":
            return attrs.get("role", "").lower() == v
        if k == "department":
            return attrs.get("department", "").lower() == v
        if k == "owner":
            # owner can be a wildcard 'patient' or specific address
            if v in ("patient", "self"):
                return bool(attrs.get("is_owner"))
            return attrs.get("address", "").lower() == v
        if k == "admin":
            return attrs.get("role") == "admin"
        return False

    # Tokenize parens + AND/OR + atoms
    expr = policy.replace("(", " ( ").replace(")", " ) ")
    tokens = re.findall(r"\(|\)|AND|OR|[^\s()]+(?::[^\s()]+)?", expr, flags=re.IGNORECASE)
    # rebuild atoms with colons (the above regex isn't perfect). Use a simpler approach.
    raw = re.findall(r"\(|\)|AND|OR|[A-Za-z]+:[A-Za-z0-9_\-]+|[A-Za-z]+:0x[0-9a-fA-F]+", policy)

    # Shunting-yard
    prec = {"OR": 1, "AND": 2}
    output, ops = [], []
    for t in raw:
        T = t.upper()
        if T in ("AND", "OR"):
            while ops and ops[-1] in ("AND", "OR") and prec[ops[-1]] >= prec[T]:
                output.append(ops.pop())
            ops.append(T)
        elif t == "(":
            ops.append(t)
        elif t == ")":
            while ops and ops[-1] != "(":
                output.append(ops.pop())
            if ops:
                ops.pop()
        else:
            output.append(t)
    while ops:
        output.append(ops.pop())
    # Evaluate RPN
    stack = []
    for t in output:
        T = t.upper()
        if T == "AND":
            b = stack.pop(); a = stack.pop(); stack.append(a and b)
        elif T == "OR":
            b = stack.pop(); a = stack.pop(); stack.append(a or b)
        else:
            stack.append(check_atom(t))
    ok = bool(stack and stack[-1])
    return ok, ("Satisfied: " + policy) if ok else ("Attributes failed: " + json.dumps({k: v for k, v in attrs.items() if k != "did"}))


# ---------- Access Requests (Doctor -> Patient) ----------
@api.post("/access/request")
async def access_request(p: AccessRequest):
    doc = {
        "id": str(uuid.uuid4()),
        "doctor_address": p.doctor_address,
        "doctor_address_lower": addr_norm(p.doctor_address),
        "patient_address": p.patient_address,
        "patient_address_lower": addr_norm(p.patient_address),
        "reason": p.reason,
        "status": "pending",
        "created_at": utcnow(),
        "responded_at": None,
        "patient_signature": None,
        "patient_message": None,
    }
    await db.access_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.post("/access/respond")
async def access_respond(p: AccessRespond):
    if not verify_sig(p.patient_address, p.message, p.signature):
        raise HTTPException(401, "Invalid patient signature")
    req = await db.access_requests.find_one({"id": p.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["patient_address_lower"] != addr_norm(p.patient_address):
        raise HTTPException(403, "Not your request")
    new_status = "approved" if p.approve else "denied"
    await db.access_requests.update_one(
        {"id": p.request_id},
        {"$set": {
            "status": new_status,
            "responded_at": utcnow(),
            "patient_signature": p.signature,
            "patient_message": p.message,
        }},
    )
    if p.approve:
        # Create or upsert grant
        await db.access_grants.update_one(
            {"doctor_address_lower": req["doctor_address_lower"], "patient_address_lower": req["patient_address_lower"]},
            {"$set": {
                "id": str(uuid.uuid4()),
                "doctor_address": req["doctor_address"],
                "doctor_address_lower": req["doctor_address_lower"],
                "patient_address": req["patient_address"],
                "patient_address_lower": req["patient_address_lower"],
                "status": "approved",
                "approved_at": utcnow(),
                "signature": p.signature,
                "message": p.message,
            }},
            upsert=True,
        )
    return {"ok": True, "status": new_status}


@api.get("/access/pending/{patient_address}")
async def access_pending(patient_address: str):
    items = await db.access_requests.find(
        {"patient_address_lower": patient_address.lower(), "status": "pending"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return items


@api.get("/access/by-patient/{patient_address}")
async def access_by_patient(patient_address: str):
    items = await db.access_requests.find(
        {"patient_address_lower": patient_address.lower()}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return items


@api.get("/access/granted/{doctor_address}")
async def access_granted(doctor_address: str):
    items = await db.access_grants.find(
        {"doctor_address_lower": doctor_address.lower(), "status": "approved"}, {"_id": 0}
    ).to_list(500)
    return items


# ---------- LPA: Layered Proof Aggregation ----------
@api.get("/lpa/pending")
async def lpa_pending():
    pending = await db.lpa_pending.find({}, {"_id": 0}).sort("added_at", 1).to_list(1000)
    # Enrich with record snippet
    rec_ids = [p["record_id"] for p in pending]
    recs = await db.records.find({"id": {"$in": rec_ids}}, {"_id": 0}).to_list(1000)
    rmap = {r["id"]: r for r in recs}
    for p in pending:
        r = rmap.get(p["record_id"])
        if r:
            p["patient_name"] = r["patient_name"]
            p["uploader_name"] = r["uploader_name"]
            p["diagnosis"] = r["diagnosis"]
            p["file_name"] = r["file_name"]
    return pending


@api.post("/lpa/preview")
async def lpa_preview():
    pending = await db.lpa_pending.find({}, {"_id": 0}).to_list(1000)
    cids = [p["cid"] for p in pending]
    tree = build_merkle(cids)
    return {"count": len(cids), "leaves": cids, **tree}


class AnchorReq(BaseModel):
    admin_address: str
    signature: str
    message: str


@api.post("/lpa/anchor")
async def lpa_anchor(p: AnchorReq):
    if not verify_sig(p.admin_address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    if p.admin_address.lower() != ADMIN["address"].lower():
        raise HTTPException(403, "Admin only")
    pending = await db.lpa_pending.find({}, {"_id": 0}).to_list(1000)
    if not pending:
        raise HTTPException(400, "Nothing to anchor")
    cids = [x["cid"] for x in pending]
    tree = build_merkle(cids)
    root = tree["root"]
    # Simulated on-chain tx
    tx_hash = keccak_hex((root + utcnow()).encode())
    block_number = await _next_block()
    anchor = {
        "id": str(uuid.uuid4()),
        "root": root,
        "tx_hash": tx_hash,
        "block_number": block_number,
        "leaf_count": len(cids),
        "leaves": cids,
        "layers": tree["layers"],
        "anchored_at": utcnow(),
        "anchored_by": p.admin_address,
        "network": "simulated",
    }
    await db.lpa_anchors.insert_one(anchor)
    rec_ids = [x["record_id"] for x in pending]
    await db.records.update_many(
        {"id": {"$in": rec_ids}},
        {"$set": {
            "anchor_status": "anchored",
            "merkle_root": root,
            "anchor_tx": tx_hash,
            "anchor_block": block_number,
        }},
    )
    await db.lpa_pending.delete_many({})
    anchor.pop("_id", None)
    return anchor


# ─────────────────────────────────────────────────────────────────────
#  POLYGON AMOY ANCHORING — REAL on-chain Merkle anchoring (live testnet)
# ─────────────────────────────────────────────────────────────────────
POLYGON_RPC = os.environ.get("POLYGON_RPC", "https://rpc-amoy.polygon.technology")
POLYGON_CHAIN_ID = int(os.environ.get("POLYGON_CHAIN_ID", "80002"))  # 80002 = Amoy
POLYGON_EXPLORER = os.environ.get("POLYGON_EXPLORER", "https://amoy.polygonscan.com")


def _get_admin_pk_hex() -> str:
    """Derive admin's private key from ADMIN_SEED (same path used everywhere)."""
    seed = os.environ.get("ADMIN_SEED", "")
    if not seed:
        raise HTTPException(500, "ADMIN_SEED not configured")
    pk = hashlib.sha256(seed.encode()).digest()
    return "0x" + pk.hex()


@api.get("/polygon/status")
async def polygon_status():
    """Show wallet balance + network info — used by frontend to gate the button."""
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(POLYGON_RPC))
        bal_wei = w3.eth.get_balance(ADMIN["address"])
        bal_pol = float(w3.from_wei(bal_wei, "ether"))
        return {
            "network": "Polygon Amoy Testnet",
            "chain_id": POLYGON_CHAIN_ID,
            "rpc": POLYGON_RPC,
            "explorer": POLYGON_EXPLORER,
            "admin_address": ADMIN["address"],
            "balance_pol": round(bal_pol, 6),
            "balance_wei": str(bal_wei),
            "funded": bal_wei > 0,
            "faucet_url": "https://faucet.polygon.technology/",
        }
    except Exception as e:
        return {"network": "Polygon Amoy Testnet", "error": str(e), "funded": False}


@api.post("/lpa/anchor-polygon")
async def lpa_anchor_polygon(p: AnchorReq):
    """Submit a REAL transaction to Polygon Amoy testnet anchoring the Merkle root.

    The Merkle root is embedded in the transaction's data field as `0x"GENC"||root`.
    Returns a real tx_hash that can be inspected on amoy.polygonscan.com.
    """
    if not verify_sig(p.admin_address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    if p.admin_address.lower() != ADMIN["address"].lower():
        raise HTTPException(403, "Admin only")

    pending = await db.lpa_pending.find({}, {"_id": 0}).to_list(1000)
    if not pending:
        raise HTTPException(400, "Nothing to anchor")

    cids = [x["cid"] for x in pending]
    tree = build_merkle(cids)
    root = tree["root"]  # 0x... hex string

    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider(POLYGON_RPC))
    if not w3.is_connected():
        raise HTTPException(503, "Polygon RPC unreachable")

    admin_pk = _get_admin_pk_hex()
    admin_addr = w3.to_checksum_address(ADMIN["address"])
    bal = w3.eth.get_balance(admin_addr)
    if bal == 0:
        raise HTTPException(402, {
            "message": "Admin wallet has 0 POL on Amoy. Request testnet POL from the faucet first.",
            "faucet": "https://faucet.polygon.technology/",
            "wallet": ADMIN["address"],
            "network": "Polygon Amoy",
        })

    # Build tx: send 0 POL to self, embedding 'GENC' || root in the data field
    root_bytes = bytes.fromhex(root[2:] if root.startswith("0x") else root)
    data = b"GENC" + root_bytes  # marker + 32-byte merkle root
    nonce = w3.eth.get_transaction_count(admin_addr)
    tx = {
        "from": admin_addr,
        "to": admin_addr,            # self-tx; the root lives in the data field
        "value": 0,
        "data": "0x" + data.hex(),
        "nonce": nonce,
        "chainId": POLYGON_CHAIN_ID,
        "gas": 60000,
        "maxFeePerGas": w3.to_wei("50", "gwei"),
        "maxPriorityFeePerGas": w3.to_wei("30", "gwei"),
    }
    signed = w3.eth.account.sign_transaction(tx, private_key=admin_pk)
    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction).hex()
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash

    # Wait for receipt (so we can return real block number)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    block_number = receipt.blockNumber

    anchor = {
        "id": str(uuid.uuid4()),
        "root": root,
        "tx_hash": tx_hash,
        "block_number": int(block_number),
        "leaf_count": len(cids),
        "leaves": cids,
        "layers": tree["layers"],
        "anchored_at": utcnow(),
        "anchored_by": p.admin_address,
        "network": "polygon-amoy",
        "explorer_url": f"{POLYGON_EXPLORER}/tx/{tx_hash}",
    }
    await db.lpa_anchors.insert_one(anchor)
    rec_ids = [x["record_id"] for x in pending]
    await db.records.update_many(
        {"id": {"$in": rec_ids}},
        {"$set": {
            "anchor_status": "anchored",
            "merkle_root": root,
            "anchor_tx": tx_hash,
            "anchor_block": int(block_number),
            "network": "polygon-amoy",
        }},
    )
    await db.lpa_pending.delete_many({})
    anchor.pop("_id", None)
    return anchor


async def _next_block() -> int:
    doc = await db.chain_state.find_one_and_update(
        {"_id": "head"},
        {"$inc": {"block": 1}},
        upsert=True,
        return_document=True,
    )
    return doc.get("block", 1) if doc else 1


@api.get("/lpa/anchors")
async def lpa_anchors():
    items = await db.lpa_anchors.find({}, {"_id": 0}).sort("anchored_at", -1).to_list(200)
    return items


class SimulateReq(BaseModel):
    admin_address: str
    signature: str
    message: str
    count: int = 10


@api.post("/lpa/simulate")
async def lpa_simulate(p: SimulateReq):
    """Admin-only: enqueue N synthetic records to the LPA pending batch for demo purposes.
    Useful for showing how the per-record cost drops as the batch grows."""
    if not verify_sig(p.admin_address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    if p.admin_address.lower() != ADMIN["address"].lower():
        raise HTTPException(403, "Admin only")
    n = max(1, min(p.count, 100))
    sample_names = ["Maria Santos", "Juan dela Cruz", "Aileen Reyes", "Mark Bautista", "Sofia Ramos",
                    "Carlo Mendoza", "Lyka Aquino", "Paolo Tan", "Rhea Garcia", "Miguel Cruz",
                    "Bea Lim", "Joey Villanueva", "Camille Torres", "Diego Pascual", "Andrea Lopez"]
    sample_dx = ["Annual physical", "Hypertension follow-up", "Lab panel", "Chest X-ray review",
                 "Diabetes management", "Cardiology consult", "ECG result", "Vaccination record",
                 "Blood test", "Allergy panel"]
    inserted = []
    for i in range(n):
        cid = "QmSim" + hashlib.sha256(f"{utcnow()}-{i}-{uuid.uuid4()}".encode()).hexdigest()[:42]
        record_id = str(uuid.uuid4())
        patient_name = sample_names[(i + n) % len(sample_names)] + f" #{i+1}"
        diagnosis = sample_dx[i % len(sample_dx)]
        # Insert a synthetic record AND a pending entry
        await db.records.insert_one({
            "id": record_id,
            "cid": cid,
            "file_name": f"sim-{i+1}.pdf.enc",
            "file_size": 12345,
            "encrypted_key_b64": "sim",
            "policy": "(Role:Doctor AND Department:Simulation) OR (Owner:simulated)",
            "diagnosis": diagnosis,
            "notes": "Synthetic demo record",
            "uploader_address": ADMIN["address"],
            "uploader_address_lower": ADMIN["address"].lower(),
            "uploader_name": "Simulation",
            "uploader_department": "Demo",
            "uploader_role": "simulation",
            "patient_address": "0xsimulated",
            "patient_address_lower": "0xsimulated",
            "patient_name": patient_name,
            "created_at": utcnow(),
            "anchor_status": "pending",
            "merkle_root": None, "anchor_tx": None, "anchor_block": None,
            "simulated": True,
        })
        await db.lpa_pending.insert_one({
            "id": str(uuid.uuid4()),
            "record_id": record_id,
            "cid": cid,
            "added_at": utcnow(),
            "patient_name": patient_name,
            "uploader_name": "Simulation",
            "diagnosis": diagnosis,
            "file_name": f"sim-{i+1}.pdf",
            "simulated": True,
        })
        inserted.append({"cid": cid, "record_id": record_id, "patient": patient_name})
    return {"inserted": len(inserted), "items": inserted}


@api.post("/lpa/clear-simulated")
async def lpa_clear_sim(p: SimulateReq):
    """Remove only simulated records (kept for demo cleanup)."""
    if not verify_sig(p.admin_address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    if p.admin_address.lower() != ADMIN["address"].lower():
        raise HTTPException(403, "Admin only")
    a = await db.records.delete_many({"simulated": True})
    b = await db.lpa_pending.delete_many({"simulated": True})
    return {"removed_records": a.deleted_count, "removed_pending": b.deleted_count}


@api.get("/lpa/stats")
async def lpa_stats():
    pending_count = await db.lpa_pending.count_documents({})
    anchor_count = await db.lpa_anchors.count_documents({})
    record_count = await db.records.count_documents({})
    user_count = await db.users.count_documents({})
    return {
        "pending": pending_count,
        "anchors": anchor_count,
        "records": record_count,
        "users": user_count,
    }


# ---------- Verification Certificates ----------
def _merkle_proof(layers: List[List[str]], leaf_index: int) -> List[Dict[str, str]]:
    """Build a sibling proof path from leaf to root."""
    proof = []
    idx = leaf_index
    for li in range(len(layers) - 1):
        layer = layers[li]
        if idx % 2 == 0:
            sib_idx = idx + 1 if idx + 1 < len(layer) else idx
            position = "right"  # sibling is on the right (concat self+sib)
        else:
            sib_idx = idx - 1
            position = "left"
        proof.append({"hash": layer[sib_idx], "position": position})
        idx = idx // 2
    return proof


class CertificateBody(BaseModel):
    record_id: Optional[str] = None
    cid: Optional[str] = None
    requester_address: str
    signature: str
    message: str
    redact_provider: bool = False
    redact_diagnosis: bool = False


@api.post("/certificate/generate")
async def certificate_generate(p: CertificateBody):
    """Patient (or admin) generates a verification certificate for one of their anchored records."""
    if not verify_sig(p.requester_address, p.message, p.signature):
        raise HTTPException(401, "Invalid signature")
    rec = None
    if p.record_id:
        rec = await db.records.find_one({"id": p.record_id}, {"_id": 0})
    elif p.cid:
        rec = await db.records.find_one({"cid": p.cid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Record not found")
    # Authorization: requester must be the patient (owner) OR the admin
    req_addr = addr_norm(p.requester_address)
    is_owner = req_addr == rec["patient_address_lower"]
    is_admin = req_addr == ADMIN["address"].lower()
    if not (is_owner or is_admin):
        raise HTTPException(403, "Only the record owner or admin may generate a certificate")
    if rec.get("anchor_status") != "anchored" or not rec.get("merkle_root"):
        raise HTTPException(400, "Record is not yet anchored on-chain")

    anchor = await db.lpa_anchors.find_one({"root": rec["merkle_root"]}, {"_id": 0})
    if not anchor:
        raise HTTPException(404, "Anchor not found for this record")

    leaves = anchor["leaves"]
    layers = anchor["layers"]
    try:
        leaf_index = leaves.index(rec["cid"])
    except ValueError:
        raise HTTPException(500, "CID not in anchor leaves (data inconsistency)")

    leaf_hash = layers[0][leaf_index]
    proof = _merkle_proof(layers, leaf_index)

    cert = {
        "kind": "GenC.MedicalRecordCertificate",
        "version": "1.0",
        "issued_at": utcnow(),
        "network": "gen-c-sim",
        "record": {
            "cid": rec["cid"],
            "leaf_hash": leaf_hash,
            "anchored_at": anchor["anchored_at"],
            "block_number": anchor["block_number"],
            "tx_hash": anchor["tx_hash"],
            "merkle_root": anchor["root"],
            "leaf_count": anchor["leaf_count"],
        },
        "merkle_proof": proof,
        "patient": {
            "did": (await db.users.find_one({"address_lower": rec["patient_address_lower"]}, {"_id": 0}) or {}).get("did"),
            "address": rec["patient_address"],
        },
        "provider": ({"REDACTED": True} if p.redact_provider else {
            "name": rec["uploader_name"],
            "department": rec.get("uploader_department"),
            "address": rec["uploader_address"],
        }),
        "diagnosis": ("REDACTED" if p.redact_diagnosis else rec["diagnosis"]),
        "verification_url": "/verify",
    }
    return cert


class CertVerifyBody(BaseModel):
    certificate: Dict[str, Any]


@api.post("/certificate/verify")
async def certificate_verify(body: CertVerifyBody):
    """Public endpoint. Re-derives the Merkle root from the certificate's leaf + proof
    and confirms it matches an anchor stored on the chain."""
    from eth_utils import keccak
    cert = body.certificate or {}
    try:
        rec = cert["record"]
        proof = cert["merkle_proof"]
        claimed_root = rec["merkle_root"]
        leaf_hash = rec["leaf_hash"]
        cid = rec["cid"]
    except Exception:
        raise HTTPException(400, "Malformed certificate")

    # 1. Re-derive leaf_hash from the CID
    derived_leaf = "0x" + keccak(text=cid).hex()
    if derived_leaf.lower() != leaf_hash.lower():
        return {"valid": False, "reason": "Leaf hash does not match keccak256(cid)"}

    # 2. Walk the proof to compute the root
    current = bytes.fromhex(leaf_hash[2:])
    for step in proof:
        sib = bytes.fromhex(step["hash"][2:])
        if step["position"] == "right":
            current = keccak(current + sib)
        else:
            current = keccak(sib + current)
    derived_root = "0x" + current.hex()

    if derived_root.lower() != claimed_root.lower():
        return {"valid": False, "reason": "Recomputed root does not match certificate root", "derived_root": derived_root, "claimed_root": claimed_root}

    # 3. Confirm anchor exists on the chain
    anchor = await db.lpa_anchors.find_one({"root": claimed_root}, {"_id": 0})
    if not anchor:
        return {"valid": False, "reason": "Merkle root not found on the chain"}

    return {
        "valid": True,
        "anchor": {
            "block_number": anchor["block_number"],
            "tx_hash": anchor["tx_hash"],
            "anchored_at": anchor["anchored_at"],
            "leaf_count": anchor["leaf_count"],
            "merkle_root": anchor["root"],
        },
        "subject": {
            "cid": cid,
            "diagnosis": cert.get("diagnosis"),
            "patient_did": cert.get("patient", {}).get("did"),
            "provider": cert.get("provider"),
        },
    }


# ---------- Upload Requests (Patient -> Doctor) ----------
class UploadRequestCreate(BaseModel):
    patient_address: str
    patient_signature: str
    patient_message: str
    doctor_address: str
    title: str
    reason: Optional[str] = ""


@api.post("/upload-requests")
async def upload_requests_create(p: UploadRequestCreate):
    if not verify_sig(p.patient_address, p.patient_message, p.patient_signature):
        raise HTTPException(401, "Invalid patient signature")
    patient = await db.users.find_one({"address_lower": addr_norm(p.patient_address)}, {"_id": 0})
    if not patient or patient["role"] != "patient":
        raise HTTPException(403, "Caller is not a registered patient")
    doctor = await db.users.find_one({"address_lower": addr_norm(p.doctor_address)}, {"_id": 0})
    if not doctor or doctor["role"] != "doctor":
        raise HTTPException(400, "Target is not a registered doctor")
    doc = {
        "id": str(uuid.uuid4()),
        "patient_address": p.patient_address,
        "patient_address_lower": addr_norm(p.patient_address),
        "patient_name": patient["name"],
        "doctor_address": p.doctor_address,
        "doctor_address_lower": addr_norm(p.doctor_address),
        "doctor_name": doctor["name"],
        "doctor_hospital": doctor.get("hospital"),
        "doctor_department": doctor.get("department"),
        "title": p.title,
        "reason": p.reason,
        "status": "pending",  # pending | fulfilled | declined
        "created_at": utcnow(),
        "fulfilled_at": None,
        "record_id": None,
    }
    await db.upload_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/upload-requests/doctor/{address}")
async def upload_requests_for_doctor(address: str):
    items = await db.upload_requests.find(
        {"doctor_address_lower": address.lower()}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return items


@api.get("/upload-requests/patient/{address}")
async def upload_requests_by_patient(address: str):
    items = await db.upload_requests.find(
        {"patient_address_lower": address.lower()}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return items


class UploadRequestFulfill(BaseModel):
    request_id: str
    doctor_address: str
    doctor_signature: str
    doctor_message: str
    record_id: str


@api.post("/upload-requests/fulfill")
async def upload_requests_fulfill(p: UploadRequestFulfill):
    if not verify_sig(p.doctor_address, p.doctor_message, p.doctor_signature):
        raise HTTPException(401, "Invalid doctor signature")
    req = await db.upload_requests.find_one({"id": p.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["doctor_address_lower"] != addr_norm(p.doctor_address):
        raise HTTPException(403, "Not the assigned doctor")
    await db.upload_requests.update_one(
        {"id": p.request_id},
        {"$set": {"status": "fulfilled", "fulfilled_at": utcnow(), "record_id": p.record_id}},
    )
    return {"ok": True}


class UploadRequestDecline(BaseModel):
    request_id: str
    doctor_address: str
    doctor_signature: str
    doctor_message: str


@api.post("/upload-requests/decline")
async def upload_requests_decline(p: UploadRequestDecline):
    if not verify_sig(p.doctor_address, p.doctor_message, p.doctor_signature):
        raise HTTPException(401, "Invalid doctor signature")
    req = await db.upload_requests.find_one({"id": p.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["doctor_address_lower"] != addr_norm(p.doctor_address):
        raise HTTPException(403, "Not the assigned doctor")
    await db.upload_requests.update_one(
        {"id": p.request_id},
        {"$set": {"status": "declined", "fulfilled_at": utcnow()}},
    )
    return {"ok": True}


# ---------- Mount ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db():
    client.close()
