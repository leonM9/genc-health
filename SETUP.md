# Gen C — Local Setup Guide

> **Gen C** is a decentralized medical-records dApp (RA 10173 compliant)
> built with React, FastAPI, MongoDB, Pinata IPFS, AES-256, simulated CP-ABE,
> and Merkle-based Layered Proof Aggregation (LPA).

This guide walks you through running the project locally in **VS Code**.

---

## TL;DR — what to run

Once you've finished sections 1–6 (one-time setup), every future startup is just **three terminals**:

```bash
# Terminal 1 — MongoDB (skip if it's already a system service)
mongod
```

```bash
# Terminal 2 — Backend
cd backend
source venv/bin/activate            # Windows: venv\Scripts\activate
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

```bash
# Terminal 3 — Frontend
cd frontend
yarn start
```

Then open **http://localhost:3000** and click **"Sign-in as Admin"** to enter the LPA console.

> First-time setup? Keep reading section 1.

---

## 1. Prerequisites (one-time installs)

Install these on your machine before doing anything else:

| Tool | Version | Download |
|---|---|---|
| **Node.js** | 20 or newer | https://nodejs.org |
| **Python** | 3.10 or newer | https://python.org/downloads |
| **MongoDB Community** | 7+ | https://mongodb.com/try/download/community |
| **Git** | any recent version | https://git-scm.com |
| **VS Code** | any recent version | https://code.visualstudio.com |

After Node.js is installed, open a terminal and run:
```bash
npm install -g yarn
```

> Optional: use **MongoDB Atlas** (cloud) instead of local MongoDB — just
> paste the Atlas connection string into `backend/.env` instead of
> `mongodb://localhost:27017`.

---

## 2. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/gen-c-health.git
cd gen-c-health
code .            # opens this folder in VS Code
```

---

## 3. Create the environment files

These files are **intentionally NOT in GitHub** (they contain secrets).
You must create them manually on your local machine.

### 3a. `backend/.env`

Create a new file at `backend/.env` and paste:

```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
CORS_ORIGINS="*"
PINATA_JWT="<paste your Pinata JWT here>"
PINATA_GATEWAY="https://gateway.pinata.cloud/ipfs"
ADMIN_SEED="genc-admin-thesis-deterministic-seed-2026"
```

> The original Pinata JWT and ADMIN_SEED used during development are shared
> separately in chat. Don't commit them to GitHub.

### 3b. `frontend/.env`

Create a new file at `frontend/.env` and paste:

```env
REACT_APP_BACKEND_URL=http://localhost:8001
```

---

## 4. Install backend dependencies

Open a terminal in VS Code (`Ctrl + ~`) and run:

```bash
cd backend
python -m venv venv
```

Activate the virtual environment:

- **Windows (PowerShell):**
  ```powershell
  venv\Scripts\activate
  ```
- **Windows (cmd):**
  ```cmd
  venv\Scripts\activate.bat
  ```
- **macOS / Linux:**
  ```bash
  source venv/bin/activate
  ```

You should see `(venv)` appear at the beginning of your terminal prompt.
Then install:

```bash
pip install -r requirements.txt
```

---

## 5. Install frontend dependencies

Open a **second terminal** (split with `Ctrl + Shift + 5`):

```bash
cd frontend
yarn install
```

---

## 6. Start MongoDB

Make sure MongoDB is running locally:

- **Windows:** open *Services* → start *"MongoDB Server"*
- **macOS:** `brew services start mongodb-community`
- **Linux:** `sudo systemctl start mongod`

To verify:
```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```
A response of `{ ok: 1 }` means it's running.

---

## 7. Run the application

**Terminal 1 — Backend** (in `/backend` with `venv` active):
```bash
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

**Terminal 2 — Frontend** (in `/frontend`):
```bash
yarn start
```

Open your browser:
- Frontend: **http://localhost:3000**
- Backend API health: **http://localhost:8001/api/**

---

## 8. Sign in for the first time

The login page gives you four paths:

| Method | Use case |
|---|---|
| **Continue with Google** | Real Google OAuth — works only when deployed (skip locally) |
| **Connect MetaMask** | If you have the MetaMask browser extension |
| **Create Demo Wallet** | Quickest — auto-generates a wallet in your browser |
| **Sign-in as Admin** | The deterministic admin wallet (LPA console) |

Recommended for testing: use **Create Demo Wallet** to register as a Doctor and Patient (in two separate browser profiles), then **Sign-in as Admin** to anchor Merkle roots.

---

## 9. Run the test suite (optional but recommended)

```bash
cd backend
source venv/bin/activate      # or venv\Scripts\activate on Windows
pytest tests/ -v
```

You should see **45 tests passing**.

---

## Project structure

```
gen-c-health/
├── backend/
│   ├── server.py              FastAPI application + all routes
│   ├── requirements.txt       Python dependencies
│   ├── tests/                 pytest suite
│   └── .env                   (you create this, NOT in Git)
├── frontend/
│   ├── src/
│   │   ├── pages/             Login, Onboarding, Admin/Doctor/Patient
│   │   ├── components/        Layout, CryptoString, MerkleVisualizer, ui/
│   │   └── lib/               walletContext, crypto, api
│   ├── package.json
│   ├── craco.config.js        Webpack overrides (@/ alias)
│   └── .env                   (you create this, NOT in Git)
├── memory/                    PRD, test credentials
├── README.md
└── SETUP.md                   this file
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB isn't running. Start the MongoDB service. |
| `uvicorn: command not found` | The virtual environment isn't activated. Re-run the activate command. |
| `yarn: command not found` | Run `npm install -g yarn`. |
| `python: command not found` (macOS) | Use `python3` and `pip3` instead. |
| `Module not found: @/...` | Run `yarn install` inside the `frontend/` folder. |
| Backend starts but frontend can't reach it | Check `frontend/.env` contains exactly `REACT_APP_BACKEND_URL=http://localhost:8001` (no quotes, no trailing slash). |
| `(venv)` doesn't appear after activate | Close the terminal, re-open it, and run the activate command again. |
| Port 3000 or 8001 already in use | Kill the other process or change the port (`uvicorn ... --port 8002`). |

---

## What gets pushed to GitHub vs. what stays local

**Pushed (visible on GitHub):**
- All source code (`.py`, `.js`, `.jsx`, `.css`)
- `requirements.txt`, `package.json`, `yarn.lock`
- Configuration files (`tailwind.config.js`, `craco.config.js`)
- Tests, this `SETUP.md`, and `README.md`

**Not pushed (excluded by `.gitignore`):**
- `node_modules/` — regenerated by `yarn install`
- `backend/venv/` — regenerated by `python -m venv venv` + `pip install`
- `.env` files — you create these manually with the secrets
- `__pycache__/` — Python's compiled cache
- Build artifacts, IDE folders, OS files

This is **normal and intentional** — never commit `.env` files containing real secrets to GitHub.

---

## Need help?

If something breaks during setup, capture:
1. The exact error message
2. Your operating system (Windows / macOS / Linux)
3. Which step you were on

Then ask for help. 90% of setup issues are one of:
- MongoDB not running
- Virtual environment not activated
- Missing `.env` file
- Wrong Node.js / Python version

Happy hacking 🛡️
