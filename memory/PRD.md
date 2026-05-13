# Gen C dApp — Product Requirements

## Original Problem Statement
A decentralized medical records dApp ("Gen C") for the Philippine Data Privacy Act (RA 10173).

## Adapted Stack (Confirmed)
- **Frontend**: React + ethers.js (modern Web3 UI — Plus Jakarta Sans + JetBrains Mono, glass cards, emerald/teal accents)
- **Backend**: FastAPI (Python) + eth_account (signature verification) + httpx/requests
- **Storage**: MongoDB (motor) + Pinata IPFS (real, JWT in .env)
- **Blockchain**: Simulated (Merkle anchoring + tx_hash + block_number stored in DB)
- **Encryption**: AES-256-GCM (Web Crypto) + simulated CP-ABE policy evaluation (shunting-yard parser)
- **Auth**: Emergent Google OAuth + MetaMask + in-browser demo wallet (deterministic from localStorage) + deterministic admin

## User Personas
- **Admin**: Operates LPA console only — Pending Batch, Merkle Anchoring, Anchored Roots history, read-only Doctors list (with hospital), read-only Patients list
- **Doctor**: Self-registers (Name + Department + Hospital). Searches patients, requests access, receives upload requests in Inbox, uploads encrypted records (AES-256 + Pinata + LPA)
- **Patient**: Self-registers (Name). Owns records, decrypts client-side, approves/denies doctor access via signature, sends Upload Requests to specific doctors

## Implemented (latest)
- ✅ Login (Google + MetaMask + Demo + Admin + import-PK)
- ✅ Self-onboarding (role select, name, doctor adds Department + Hospital)
- ✅ Admin: LPA Batch, Merkle Tree Visualizer, Anchored Roots, Doctors tab (w/ Hospital column), Patients tab
- ✅ Doctor: Patients search, Inbox (upload requests w/ Fulfill+Decline), Upload pipeline (AES → IPFS → CP-ABE → LPA), My Records
- ✅ Patient: Records w/ client-side decrypt, Access requests inbox, Request Upload tab (signed request to a chosen doctor)
- ✅ Hybrid signature/cookie auth on user registration
- ✅ Deterministic demo wallet rehydration from localStorage
- ✅ Pinata IPFS real upload + gateway proxy

## Test Status (2026-02-13)
- Backend: **56/56 pytest passing (iter 6)** — 45 base + 11 new admin-feature tests
- Frontend: iter 6 verified login → admin → register doctor → register patient → attach file pipeline → LpaCostChart end-to-end
- Verified flows: admin-register doctor/patient (signed by ADMIN), admin-upload encrypted record on behalf of patient (AES → Pinata → CP-ABE → LPA), Merkle anchor, cost-per-record chart updates with batch size

## Recently Added (2026-02-13)
- Admin can **register Doctors** (name + dept + hospital + wallet) — generates demo wallet on-the-fly
- Admin can **register Patients** (name + wallet) — generates demo wallet on-the-fly
- Admin can **attach a medical file** to any registered patient (full AES+IPFS+LPA pipeline, marked uploader_role=admin)
- **LpaCostChart** component visualizes gas cost per record dropping as batch size grows (with/without LPA overlay + savings %)
- Sky-blue/cyan theme retained (replaced earlier emerald)
- SETUP.md TL;DR section + run commands for friend's local VS Code

## Prioritized Backlog
- P2: Real Solidity contracts (UserRegistry.sol, MedicalAnchors.sol) + Sepolia testnet toggle
- P2: Replace blocking `requests` with `httpx.AsyncClient` in Pinata + Google handlers
- P2: Split server.py (~970 LOC) into per-domain routers
- P3: Audit log per decrypt-key request
- P3: Signature gating on /access/request and /upload-requests/fulfill (sig verification added to fulfill in latest patch)
- P3: PDF preview in patient vault
- P3: Multi-language UI (Filipino/English)
- P3: Public verification proof certificate generator (patient generates redacted Merkle proof receipt)

## Files of Note
- /app/backend/server.py — all API endpoints
- /app/backend/.env — PINATA_JWT, ADMIN_SEED, MONGO_URL
- /app/frontend/src/pages/{Login,Onboarding,AdminDashboard,DoctorDashboard,PatientDashboard,AuthCallback}.jsx
- /app/frontend/src/lib/{walletContext,crypto,api}.{jsx,js}
- /app/frontend/src/components/{Layout,CryptoString,MerkleVisualizer}.jsx
- /app/memory/test_credentials.md — admin private key
- /app/auth_testing.md — auth testing playbook
