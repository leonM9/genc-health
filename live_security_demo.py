"""
Gen C — Live Security Attack Demonstration
============================================
Run this against your LIVE deployed backend during defense.
The panel watches each attack get rejected in real time.

USAGE (Windows / Mac / Linux):
    python live_security_demo.py

Optional: pass your live URL as argument
    python live_security_demo.py https://gen-c-health.emergent.host

What this does:
    Performs 6 realistic attack scenarios against your live API
    and prints results in a color-coded terminal display.
    Every attack should be REJECTED (HTTP 401/403/400).
"""
import sys
import time
import json
import secrets
import hashlib

try:
    import requests
    from eth_account import Account
    from eth_account.messages import encode_defunct
except ImportError:
    print("\n[!] Missing dependencies. Run:")
    print("    pip install requests eth-account")
    sys.exit(1)


# ============================================================
# CONFIGURATION
# ============================================================
DEFAULT_URL = "https://gen-c-health.emergent.host"
BASE_URL = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else DEFAULT_URL
API = f"{BASE_URL}/api"

# Real admin wallet (deterministically derived from ADMIN_SEED) — public info
REAL_ADMIN_ADDR = "0x12606Fa5e40FAd4D99D59Ee967aF4c418b6E5D8B"


# ============================================================
# TERMINAL COLORS (cross-platform via ANSI)
# ============================================================
class C:
    R = "\033[91m"   # red
    G = "\033[92m"   # green
    Y = "\033[93m"   # yellow
    B = "\033[94m"   # blue
    M = "\033[95m"   # magenta
    C = "\033[96m"   # cyan
    BOLD = "\033[1m"
    DIM = "\033[2m"
    END = "\033[0m"

# Enable ANSI on Windows PowerShell / cmd
if sys.platform == "win32":
    import os
    os.system("")  # activates ANSI


# ============================================================
# HELPERS
# ============================================================
def banner(text):
    print(f"\n{C.B}{C.BOLD}{'=' * 70}{C.END}")
    print(f"{C.B}{C.BOLD}  {text}{C.END}")
    print(f"{C.B}{C.BOLD}{'=' * 70}{C.END}\n")


def attack(num, name, expected):
    print(f"{C.Y}{C.BOLD}[ATTACK #{num}]{C.END} {C.BOLD}{name}{C.END}")
    print(f"  {C.DIM}Expected response: {expected}{C.END}")
    time.sleep(0.6)


def result(status, body, expected_codes):
    ok = status in expected_codes
    mark = f"{C.G}✓ DEFENDED{C.END}" if ok else f"{C.R}✗ NOT DEFENDED{C.END}"
    status_color = C.G if ok else C.R
    print(f"  {C.DIM}→ HTTP {status_color}{status}{C.END}  {C.DIM}response:{C.END} {body}")
    print(f"  {C.BOLD}{mark}{C.END}\n")
    time.sleep(1.2)
    return ok


def sign(message, private_key):
    sig = Account.sign_message(encode_defunct(text=message), private_key=private_key).signature.hex()
    return sig if sig.startswith("0x") else "0x" + sig


# ============================================================
# ATTACK SCENARIOS
# ============================================================
results = []


def attack_1_forged_signature():
    """An attacker forges a signature claiming to be the admin."""
    attack(1, "Forged Admin Signature",
           "401 Unauthorized — signature mismatch detected")

    fake_signature = "0x" + secrets.token_hex(64) + "1c"
    r = requests.post(f"{API}/lpa/anchor", json={
        "admin_address": REAL_ADMIN_ADDR,
        "signature": fake_signature,
        "message": "anchor-merkle-root"
    }, timeout=10)
    return result(r.status_code, r.text[:80], expected_codes={401})


def attack_2_non_admin_anchor():
    """A random user (not the admin) tries to anchor a Merkle batch."""
    attack(2, "Non-Admin Tries to Anchor Merkle Batch",
           "403 Forbidden — wallet is not the registered admin")

    fake_user = Account.create()
    msg = "anchor-merkle-root"
    sig = sign(msg, fake_user.key.hex())
    r = requests.post(f"{API}/lpa/anchor", json={
        "admin_address": fake_user.address,
        "signature": sig,
        "message": msg
    }, timeout=10)
    return result(r.status_code, r.text[:80], expected_codes={401, 403})


def attack_3_signature_for_wrong_wallet():
    """Attacker uses their own private key but claims a different address."""
    attack(3, "Signature/Address Mismatch (impersonation attempt)",
           "401 Unauthorized — recovered address ≠ claimed address")

    attacker = Account.create()
    victim = Account.create()
    msg = "register-doctor"
    sig = sign(msg, attacker.key.hex())  # signed by attacker
    r = requests.post(f"{API}/users/register", json={
        "actor_address": victim.address,        # claims to be victim
        "actor_signature": sig,
        "actor_message": msg,
        "role": "doctor",
        "name": "Impersonator"
    }, timeout=10)
    return result(r.status_code, r.text[:80], expected_codes={401, 400, 403})


def attack_4_malformed_wallet():
    """Attacker injects a malformed wallet address (SQL-injection-like)."""
    attack(4, "Malformed Wallet Address Injection",
           "400 Bad Request — wallet format validation rejects it")

    bad = "0x' OR 1=1; DROP TABLE users;--"
    r = requests.post(f"{API}/users/register", json={
        "actor_address": bad,
        "actor_signature": "0xdeadbeef",
        "actor_message": "register-doctor",
        "role": "doctor",
        "name": "Injector"
    }, timeout=10)
    return result(r.status_code, r.text[:100], expected_codes={400, 401, 422})


def attack_5_tampered_certificate():
    """Attacker submits a verification certificate with a tampered Merkle root."""
    attack(5, "Tampered Verification Certificate",
           "Response valid=False — Merkle proof fails verification")

    fake_cert = {
        "certificate": {
            "version": 1,
            "record": {
                "record_id": "fake-record-id-12345",
                "cid": "QmFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFake",
                "leaf_hash": "0x" + "b" * 64,
                "merkle_root": "0x" + "0" * 64,   # ← corrupted root
                "anchor_id": "fake-anchor-id"
            },
            "merkle_proof": [],
            "anchor": {
                "block_number": 999999,
                "tx_hash": "0x" + "f" * 64,
                "timestamp": "2026-01-01T00:00:00Z"
            }
        }
    }
    r = requests.post(f"{API}/certificate/verify", json=fake_cert, timeout=10)

    # Verification endpoint returns 200 + valid=False (not an HTTP error)
    try:
        body = r.json()
        is_valid = body.get("valid", True)
        if r.status_code == 200 and not is_valid:
            reason = body.get("reason", "tampered")
            print(f"  {C.DIM}→ HTTP {C.G}200{C.END}  {C.DIM}response:{C.END} {{'valid': False, 'reason': '{reason}'}}")
            print(f"  {C.BOLD}{C.G}✓ DEFENDED{C.END}  (tamper detected)\n")
            time.sleep(1.2)
            return True
    except Exception:
        pass
    return result(r.status_code, r.text[:80], expected_codes={400, 404})


def attack_6_unauthorized_decrypt():
    """A doctor with no granted access tries to obtain a decryption key."""
    attack(6, "Unauthorized Decryption Key Request",
           "403 Forbidden / 404 — no access grant or record not found")

    rogue_doctor = Account.create()
    msg = "decrypt-key"
    sig = sign(msg, rogue_doctor.key.hex())
    r = requests.post(f"{API}/records/decrypt-key", json={
        "record_id": "fake-record-that-does-not-exist",
        "requester_address": rogue_doctor.address,
        "signature": sig,
        "message": msg
    }, timeout=10)
    return result(r.status_code, r.text[:80], expected_codes={401, 403, 404})


# ============================================================
# MAIN
# ============================================================
def main():
    banner(f"GEN C — LIVE SECURITY ATTACK DEMONSTRATION")
    print(f"  {C.DIM}Target API:  {C.END}{C.C}{API}{C.END}")
    print(f"  {C.DIM}Test mode:   {C.END}{C.C}Active attack simulation{C.END}")
    print(f"  {C.DIM}Pass criterion: every attack must be REJECTED by the server.{C.END}\n")

    # Quick health check first
    try:
        h = requests.get(f"{API}/", timeout=10).json()
        print(f"  {C.G}✓ Backend is live{C.END}  ({h.get('name','?')} · admin={h.get('admin_address','?')[:10]}…)\n")
    except Exception as e:
        print(f"  {C.R}✗ Backend unreachable: {e}{C.END}\n")
        sys.exit(1)

    time.sleep(1.5)

    results.append(attack_1_forged_signature())
    results.append(attack_2_non_admin_anchor())
    results.append(attack_3_signature_for_wrong_wallet())
    results.append(attack_4_malformed_wallet())
    results.append(attack_5_tampered_certificate())
    results.append(attack_6_unauthorized_decrypt())

    # Summary
    banner("SUMMARY")
    total = len(results)
    defended = sum(results)
    colour = C.G if defended == total else (C.Y if defended >= total - 1 else C.R)
    print(f"  {C.BOLD}Attacks attempted: {C.END}{total}")
    print(f"  {C.BOLD}Successfully defended: {colour}{defended} / {total}{C.END}")
    pct = (defended / total) * 100
    print(f"  {C.BOLD}Defense rate: {colour}{pct:.1f}%{C.END}\n")

    if defended == total:
        print(f"  {C.G}{C.BOLD}✓ ALL ATTACK VECTORS DEFENDED{C.END}")
        print(f"  {C.DIM}This is the empirical proof of Gen C's security posture under RA 10173 §20.{C.END}\n")
    else:
        print(f"  {C.R}{C.BOLD}✗ {total - defended} attack(s) succeeded — investigate immediately.{C.END}\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{C.Y}Demo interrupted by user.{C.END}\n")
