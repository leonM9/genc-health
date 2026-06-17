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
- **SETUP.md fully rewritten** with two parts: (A) deploy to a real public domain via Emergent + MongoDB Atlas; (B) local VS Code dev. Includes "proof it's on a domain" checklist for thesis defense.
- Moved `@emergentbase/visual-edits` to `optionalDependencies` in package.json so install never fails on networks that can't reach Emergent CDN.

## Defense Polish (2026-02-25)
- 🔧 **Clipboard fallback** (`/app/frontend/src/lib/clipboard.js`) — Modern Clipboard API is blocked inside the Emergent preview iframe by Permissions Policy, which caused an "Uncaught runtime errors" overlay to cover the whole app when Copy PK / Copy Hash / Copy Share Link buttons were clicked. New helper tries the modern API then falls back to `textarea + document.execCommand('copy')`. Replaced all `navigator.clipboard.writeText` call sites: `AdminDashboard.jsx` (copyText, Copy PK in both seed modal + generator), `PatientDashboard.jsx` (copyShareLink), `components/CryptoString.jsx` (Hash copy button).
- 🎓 **Panel-friendly vocabulary cleanup** — Replaced all forbidden terms on user-facing UI:
  - "Hyperledger Besu chain" → "EVM-compatible permissioned ledger" (Login hero copy)
  - "Hyperledger Besu (sim)" → "EVM Permissioned Ledger" (Login footer)
  - "AES-256 · CP-ABE (sim) · QBFT (sim) · Pinata IPFS · LPA" → "AES-256 · PBAE · QBFT · Pinata IPFS · LPA" (Dashboard footer)
  - "CP-ABE" policy card → "PBAE"
  - "Wrapping AES key under CP-ABE policy…" → "…under PBAE policy…" (Admin + Doctor upload pipeline)
  - "Anchor Merkle Root (n) · Simulated" → "…· Permissioned Ledger"
  - "Demo Simulator" section → "Batch Populator"
  - "Clear simulated" → "Clear synthetic"
  - "Merkle root anchored (simulated)" toast → "Merkle root anchored to permissioned ledger"
  - "SIMULATION RECEIPT" / "Records Simulated" / "FREE (simulation)" → "BATCH POPULATED" / "Batch Populated" / "FREE (synthetic batch)"

## Auth + Medico-Legal Overhaul (2026-06-05)
Driven by thesis advisor + practising MD feedback ("patients shouldn't see every record; CID exposure is sensitive; private key should not appear in login").

### Backend
- `db.credentials` collection — `{username, password_hash (bcrypt), wallet_address, wallet_private_key}` keyed on `wallet_address_lower`.
- New endpoints under `/api/auth/credentials/*`:
  - `POST /register` — wallet-signed bind of username + password
  - `POST /login` — username + password → returns wallet + role + profile
  - `POST /export-key` — re-verify password and release the private key (audited)
  - `GET /check/{username}` — availability lookup
- Admin credentials auto-seeded on backend startup: `admin / admin123`.
- Whitelisted record vocabulary (rejected with HTTP 400 if violated):
  - `ALLOWED_LABELS = {Doctor Only, Patient Only}`
  - `ALLOWED_CATEGORIES = {Cardiology, Radiology, Neurology, General, Lab Results, Imaging, Prescription, Immunization, Laboratory}`
- `/admin/seed-demo-scenario` now returns **2 doctors + 3 patients + 5 records** each with `username/password` + appropriate label & category.

### Frontend
- **Login**: username/password is the primary form (Phosphor User + Key icons). MetaMask + new-wallet collapsed behind "+ wallet options". Inline private-key input REMOVED. "Sign-in as Admin" button REMOVED.
- **Onboarding**: adds Specialty dropdown for doctors (Cardiology, Radiology, …) and a mandatory Username + Password block. After saving the role, `registerCredentials` binds the wallet to the chosen creds.
- **Layout topbar**: persistent **Export Key** button. Opens a password-gated modal that calls `/auth/credentials/export-key` and reveals/copies/downloads the wallet private key.
- **Doctor Dashboard**: record table re-grouped into a per-patient collapsible card (`PatientGroup`). CIDs render as `Qm****…last4` with a Phosphor Eye/EyeSlash reveal toggle. "Patient-Only" records are siphoned into a separate **Patient-Only Records (Restricted)** notice so the doctor never decrypts something the patient hasn't shared explicitly.
- **Doctor & Admin upload forms**: Access Label + Category dropdowns required.
- **Patient Dashboard**: "Approve & Sign" now opens a per-record checkbox modal. Records whose `category` matches the requesting doctor's `department` are auto-checked with an "auto-match" badge. Selection passes through `record_ids` to `/access/respond` so the doctor only sees what the patient explicitly ticked.
- **Demo modal**: lists all 5 personas with username + password + address + COPY LOGIN button instead of raw private keys.

### Test status (iter 7)
- Backend: **91/91 pytest** (70 prior + 21 new credentials/seed/label).
- Frontend: primary login, admin → seed → doctor1 → patient1 round-trip visually verified.
- Test credentials updated in `/app/memory/test_credentials.md`.

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
