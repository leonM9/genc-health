# Gen C dApp — Product Requirements

## Original Problem Statement
A decentralized medical records dApp ("Gen C") for the Philippine Data Privacy Act (RA 10173). Stack envisioned: React + Ethers + Node + Hyperledger Besu (QBFT) + IPFS (Pinata) + AES-256 + CP-ABE + LPA (Merkle batching).

## Adapted Stack (Confirmed with user)
- **Frontend**: React + ethers.js (modern Web3 UI)
- **Backend**: FastAPI (Python) + eth_account for sig verification
- **Storage**: MongoDB (motor) + Pinata IPFS (real, JWT in .env)
- **Blockchain**: simulated (Merkle anchoring + tx_hash + block_number stored in DB)
- **Encryption**: AES-256-GCM (Web Crypto) + simulated CP-ABE policy evaluation server-side
- **Auth**: Emergent Google OAuth + MetaMask Sign-In with Ethereum + in-browser demo wallet + deterministic admin

## User Personas
- **Admin** (deterministic wallet from ADMIN_SEED) — operates the LPA console, anchors Merkle roots, views read-only registry
- **Doctor** — self-registers with role + department, searches patients, requests access, uploads encrypted records
- **Patient** — self-registers with role, owns records, approves/denies access via wallet signature, decrypts records client-side

## Core Requirements (Static)
- No plaintext ever stored in DB or "on-chain"
- Every action that proves authorship uses an Ethereum personal_sign signature verified server-side
- IPFS CIDs aggregated into Merkle trees; only roots anchored
- CP-ABE policies bind decryption to attributes: `(Role:Doctor AND Department:X) OR (Owner:patient)`
- Patient-signed grants override department mismatch for cross-specialist access

## Implemented (2026-02-13)
- ✅ Login screen with 4 sign-in paths (Google OAuth, MetaMask, Demo Wallet, Admin)
- ✅ Self-onboarding page (role + name + department)
- ✅ Admin LPA Console (pending batch, Merkle tree SVG viz, anchor button, anchors history, read-only registry)
- ✅ Patient vault (record list, decrypt-and-download, access request inbox with sign-to-approve)
- ✅ Doctor portal (patient search by DID/wallet, access request flow, encrypted upload with live pipeline animation)
- ✅ AES-256-GCM client-side encryption + Pinata IPFS pinning (real)
- ✅ Simulated CP-ABE policy evaluator (shunting-yard parser, supports AND/OR/parens, Role/Department/Owner atoms)
- ✅ Merkle tree builder (keccak256, matches frontend preview)
- ✅ Self-registration endpoint (signature OR cookie auth, idempotent)
- ✅ Google OAuth via Emergent Auth → deterministic wallet derivation from Google sub ID
- ✅ Session cookie management with 7-day TTL
- ✅ Modern Web3 design: Plus Jakarta Sans + JetBrains Mono, glass cards, emerald/teal accents, mesh gradients
- ✅ 25/25 backend pytest tests pass

## Prioritized Backlog
- **P1**: Split server.py (834 lines) into routers/auth, routers/records, routers/lpa
- **P1**: Signature gate on POST /api/access/request to prevent inbox spam
- **P2**: Replace `requests` with `httpx.AsyncClient` for non-blocking I/O
- **P2**: Real Solidity contracts (UserRegistry.sol, MedicalAnchors.sol) + Sepolia testnet deployment toggle
- **P2**: Doctor's "Upload Request" flow for patients (patient initiates record upload to a chosen doctor)
- **P3**: Audit log table per record (every decrypt-key request)
- **P3**: PDF preview before download
- **P3**: Multi-language UI (Filipino/English toggle)
- **P3**: Patient export of entire vault as encrypted bundle

## Next Tasks
- Wait for user feedback (defense rehearsal pass?)
- Optionally implement P1 items if asked
