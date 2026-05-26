#!/bin/bash
# Gen C — Defense-ready test battery
# Runs Unit + Integration + Security pytest suites + Live Security Attack Demo
# Usage:   bash /app/run_defense_tests.sh
# Output:  4 clearly separated sections with PASS/FAIL summary at the end

set +e  # don't bail on individual test failures — we want to see all 4 sections

VENV_PY="/root/.venv/bin/python"
BACKEND="/app/backend"
PREVIEW_URL="https://gen-c-health.preview.emergentagent.com"

# Use venv python explicitly so this script works regardless of shell state
PYTEST="$VENV_PY -m pytest"

# Color codes
B="\033[1m"
G="\033[92m"
R="\033[91m"
C="\033[96m"
Y="\033[93m"
DIM="\033[2m"
N="\033[0m"

banner() {
    echo ""
    echo -e "${C}${B}════════════════════════════════════════════════════════════${N}"
    echo -e "${C}${B}  $1${N}"
    echo -e "${C}${B}════════════════════════════════════════════════════════════${N}"
}

# ── 1. Unit tests ──────────────────────────────────────────────────────
banner "TIER 1 / 4 · UNIT TESTS"
echo -e "${DIM}Single-endpoint validation: health, auth/verify, registration,"
echo -e "wallet info, IPFS upload, LPA preview${N}"
echo ""
cd "$BACKEND" && $PYTEST tests/ -m unit -v
UNIT_RC=$?

# ── 2. Integration tests ───────────────────────────────────────────────
banner "TIER 2 / 4 · INTEGRATION TESTS"
echo -e "${DIM}Multi-step end-to-end flows: record upload → AES encryption →"
echo -e "Pinata IPFS pinning → LPA Merkle anchoring → access request →"
echo -e "patient approval → doctor decrypt → certificate generation & verify${N}"
echo ""
cd "$BACKEND" && $PYTEST tests/ -m integration -v
INTEG_RC=$?

# ── 3. Security tests (pytest negative paths) ──────────────────────────
banner "TIER 3 / 4 · SECURITY TESTS (negative paths)"
echo -e "${DIM}Forged signatures, role violations, tampered certificates,"
echo -e "unauthorized decrypt, non-admin anchor attempts, impersonation${N}"
echo ""
cd "$BACKEND" && $PYTEST tests/ -m security -v
SEC_RC=$?

# ── 4. Live security attack demo ───────────────────────────────────────
banner "TIER 4 / 4 · LIVE SECURITY ATTACK DEMO"
echo -e "${DIM}Six real attack vectors fired at the live deployed backend.${N}"
echo -e "${DIM}Each one must be REJECTED by the server (HTTP 401/403/400).${N}"
echo ""
$VENV_PY /app/live_security_demo.py "$PREVIEW_URL"
LIVE_RC=$?

# ── Final summary ──────────────────────────────────────────────────────
echo ""
echo -e "${C}${B}════════════════════════════════════════════════════════════${N}"
echo -e "${C}${B}  FINAL DEFENSE TEST BATTERY · SUMMARY${N}"
echo -e "${C}${B}════════════════════════════════════════════════════════════${N}"

verdict() {
    if [ $2 -eq 0 ]; then echo -e "  ${G}${B}✓ PASS${N}  $1"
    else echo -e "  ${R}${B}✗ FAIL${N}  $1 (exit=$2)"
    fi
}
verdict "TIER 1 · Unit tests          " $UNIT_RC
verdict "TIER 2 · Integration tests   " $INTEG_RC
verdict "TIER 3 · Security tests      " $SEC_RC
verdict "TIER 4 · Live attack demo    " $LIVE_RC

if [ $UNIT_RC -eq 0 ] && [ $INTEG_RC -eq 0 ] && [ $SEC_RC -eq 0 ] && [ $LIVE_RC -eq 0 ]; then
    echo ""
    echo -e "  ${G}${B}🎓  ALL FOUR TIERS PASSED — DEFENSE-READY${N}"
    exit 0
else
    echo ""
    echo -e "  ${R}${B}⚠  Some tiers failed — inspect the section above for details${N}"
    exit 1
fi
