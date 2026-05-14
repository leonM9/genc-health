# Gen C — Setup & Deployment Guide

> **Gen C** is a decentralized medical-records dApp (RA 10173 Data Privacy Act compliant)
> built with React + FastAPI + MongoDB + Pinata IPFS + AES-256 + simulated CP-ABE
> + Merkle-based Layered Proof Aggregation (LPA).

This guide has **two parts**:

- **Part A — Deploy to a real public domain** (recommended for thesis defense). Your app will live at a real URL like `https://gen-c-health.emergent.host`. No localhost. No friend-side setup required.
- **Part B — Run locally in VS Code** (only needed for developers editing the code).

---

# Part A — Deploy to a domain (Emergent + MongoDB Atlas)

You'll deploy the app to Emergent's cloud and connect a free cloud database (MongoDB Atlas). After this, your thesis URL is public, real, and accessible from any browser.

## Step A1 — Create a free MongoDB Atlas database (5 minutes)

1. Open https://www.mongodb.com/cloud/atlas/register and sign up
2. Click **+ Create** (or **Build a Database**) → pick **M0 FREE** tier
3. Choose region nearest to you (Singapore for the Philippines) → name the cluster `genc-cluster` → click **Create Deployment**
4. **Security Quickstart** → create a database user:
   - Username: `genc`
   - Password: click **Autogenerate Secure Password** and **save it somewhere (Notes / paper)**
   - Click **Create Database User**
5. **Where would you like to connect from?** → click **My Local Environment** → add IP `0.0.0.0/0` (this means "allow from anywhere", required so Emergent can connect) → **Finish and Close**
6. Click **Database** on left sidebar → next to your cluster click **Connect** → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://genc:<password>@genc-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. **Replace `<password>` with the actual password you saved in step 4.** Keep this final string ready — you'll paste it in Step A3.

## Step A2 — Deploy in Emergent

In the Emergent chat interface:

1. Click the **Deploy** button (top-right of the screen)
2. Confirm the deployment. Wait ~3 minutes while it spins up the servers.
3. You'll get a public URL like `https://gen-c-health.emergent.host`. **Do not open it yet** — you still need to set environment variables.

## Step A3 — Set production environment variables

In the Emergent **Deployment panel** → **Environment Variables** → click **Backend** tab. Paste these 6 variables (one per row):

| Key | Value |
|---|---|
| `MONGO_URL` | the connection string from Step A1.7 |
| `DB_NAME` | `genc_production` |
| `CORS_ORIGINS` | (your deployed URL, e.g. `https://gen-c-health.emergent.host`) |
| `PINATA_JWT` | (paste your Pinata JWT here — see the chat history; this is the same JWT you put in `backend/.env` locally) |
| `PINATA_GATEWAY` | `https://gateway.pinata.cloud/ipfs` |
| `ADMIN_SEED` | `genc-admin-thesis-deterministic-seed-2026` |

Click **Save**, then **Redeploy** (so the backend restarts with these values).

> Frontend env vars are auto-configured — you don't need to set `REACT_APP_BACKEND_URL` manually.

## Step A4 — Verify the live deployment

After redeploy finishes (~2 min):

1. Open your deployment URL in a browser: `https://gen-c-health.emergent.host`
2. You should see the **Gen C** login page (same as the preview)
3. Click **"Sign-in as Admin"** → should land on `/admin`
4. Click **"Create Demo Wallet"** in another browser tab → should land on `/onboarding`

If both work, you're **live on a real public domain**. 🎉

## Step A5 — Proof it's on a real domain (for your thesis defense)

Take these screenshots to include in your thesis paper / defense slide:

1. **Browser URL bar showing `https://...` with the green padlock** (HTTPS = real domain with SSL certificate)
2. **WHOIS / DNS lookup** — paste your URL into https://www.whois.com/whois/ → screenshot the resulting record showing the domain is registered and live
3. **From a friend's phone** — open the URL on a totally different network (cellular data) → screenshot the working app. This proves it's not a localhost fake.
4. **Backend health check** — open `https://gen-c-health.emergent.host/api/` → should return `{"name":"Gen C dApp","ok":true,"admin_address":"0x12606..."}` → screenshot this too

## Step A6 (Optional) — Attach a custom `.com.ph` domain

If your panel requires you to own the domain name (not just a subdomain on emergent.host):

1. Buy `gen-c-health.com.ph` from https://dot.ph (~₱1,200/year) or any registrar
2. In Emergent **Deployment panel** → **Custom Domain** → enter `gen-c-health.com.ph`
3. Emergent will show 2 DNS records (a CNAME + a TXT). Copy them.
4. Log in to dot.ph → My Domains → Manage DNS → add the 2 records → Save
5. Wait 10-30 minutes for DNS propagation (you can check at https://dnschecker.org)
6. Your URL becomes `https://gen-c-health.com.ph`. Done.

---

# Part B — Run locally in VS Code (for developers)

> **You only need this if you (or a teammate) wants to edit the code.** End users / your thesis panel should use the deployed URL from Part A.

## ⚠️ Use `yarn`, not `npm`

This project pins `react@19` and several UI libraries haven't bumped their peer-dep ranges yet. `npm install` will fail with `ERESOLVE` errors. **Use `yarn install`.** If you absolutely must use npm, run `npm install --legacy-peer-deps` instead.

## B1 — Prerequisites (one-time)

Install these tools on your machine:

| Tool | Version | Download |
|---|---|---|
| **Python** | 3.10 or newer | https://python.org/downloads (✅ **check "Add Python to PATH"** during install) |
| **Node.js** | 20 or newer (LTS) | https://nodejs.org |
| **Yarn** | latest | After installing Node, run `npm install -g yarn` |
| **Git** | any recent | https://git-scm.com |
| **VS Code** | any recent | https://code.visualstudio.com |

Verify everything is installed by running these in PowerShell:
```powershell
python --version       # should print 3.10+ (or use `py --version`)
node --version         # should print v20+
yarn --version         # should print 1.22+
git --version          # any version
```

If any of those say "not recognized", install that tool again and **restart VS Code** before continuing.

## B2 — Clone the repo

```powershell
git clone https://github.com/YOUR_USERNAME/genc-health.git
cd genc-health
code .
```

## B3 — Create the local `.env` files

These files are **NOT** in GitHub (they contain secrets). You must create them manually.

### `backend/.env`

In VS Code, create a new file at `backend/.env` and paste:

```env
MONGO_URL=mongodb+srv://genc:<password>@genc-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
DB_NAME=genc_local
CORS_ORIGINS=http://localhost:3000
PINATA_JWT=<your Pinata JWT>
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs
ADMIN_SEED=genc-admin-thesis-deterministic-seed-2026
```

> 💡 Use the **same MongoDB Atlas connection string** you created in Part A — Step A1. Both local and deployed versions can share the same cloud database. (Or set `DB_NAME=genc_local` so local doesn't pollute production data.)
>
> 💡 The Pinata JWT is shared separately in your chat (do **NOT** commit it to GitHub).

### `frontend/.env`

Create a new file at `frontend/.env` (yes, a file named exactly `.env`) and paste **only this one line**:

```env
REACT_APP_BACKEND_URL=http://localhost:8001
```

⚠️ Do not put `MONGO_URL` or any other variable in `frontend/.env` — those belong in `backend/.env`.

## B4 — Install backend dependencies

Open a PowerShell terminal in VS Code (`Ctrl + \``) and run:

```powershell
cd backend
python -m venv venv
```

> If `python` isn't recognized, try `py -3 -m venv venv`.

**Activate the virtual environment** (the prompt will get a `(venv)` prefix):

```powershell
.\venv\Scripts\Activate.ps1
```

> 🛑 **If PowerShell says "running scripts is disabled"**, run this once and try again:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Type `Y` to accept.

Then install:
```powershell
pip install -r requirements.txt
```

## B5 — Install frontend dependencies

Open a **second** PowerShell terminal in VS Code (`Ctrl + Shift + 5`):

```powershell
cd frontend
yarn install
```

## B6 — Run the app

You need **2 terminals running simultaneously** (3 if your database is local instead of Atlas).

### Terminal 1 — Backend (inside `backend/` with `(venv)` active)
```powershell
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```
Wait until you see `Uvicorn running on http://0.0.0.0:8001`. **Leave this terminal open.**

### Terminal 2 — Frontend (inside `frontend/`)
```powershell
yarn start
```
Wait until you see `Compiled successfully!` and the browser auto-opens at `http://localhost:3000`.

### Verify it works
- Frontend: http://localhost:3000 → you should see the Gen C login page
- Backend health: http://localhost:8001/api/ → should return `{"name":"Gen C dApp","ok":true,...}`

Click **"Sign-in as Admin"** to enter the LPA console.

---

## Troubleshooting (the friend's most-common errors)

| Error | Fix |
|---|---|
| `npm ERR! ERESOLVE could not resolve` | Use `yarn install` instead of `npm install`. If you must use npm, run `npm install --legacy-peer-deps`. |
| `.\venv\Scripts\activate is not recognized` | The venv folder doesn't exist yet. Run `python -m venv venv` first (Step B4). |
| `running scripts is disabled on this system` | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, then retry activate. |
| `mongosh: not recognized` | You don't need mongosh — you're using cloud MongoDB Atlas (no local install). Skip that step. |
| `python: not recognized` | Reinstall Python from python.org with the **"Add Python to PATH"** checkbox checked. Restart VS Code. |
| `yarn: not recognized` | Run `npm install -g yarn`. Restart VS Code. |
| `ERR_CONNECTION_REFUSED on localhost:8001` | The backend isn't running. Open Terminal 1, activate venv, and run uvicorn (Step B6). |
| Frontend opens but buttons do nothing, console shows `ERR_CONNECTION_REFUSED` | Same as above — backend is down. |
| `MongoServerError: bad auth` | Your `MONGO_URL` has the wrong password OR you forgot to replace `<password>` placeholder with the real password. |
| Backend logs show `ServerSelectionTimeoutError` | In MongoDB Atlas → Network Access, make sure `0.0.0.0/0` is in the IP allowlist. |
| `Module not found: @/...` | Run `yarn install` again inside `frontend/`. |
| Port 3000 or 8001 already in use | Kill the other process or change ports (`uvicorn ... --port 8002`, and update `frontend/.env` accordingly). |

---

## How the two environments fit together

```
┌─────────────────────────────────────────────────────────┐
│ VS CODE (local dev)                                     │
│ frontend → http://localhost:3000                        │
│ backend  → http://localhost:8001                        │
│ database → MongoDB Atlas (cloud, shared)                │
└─────────────────────────────────────────────────────────┘
                          ↓
                Push to GitHub
                          ↓
┌─────────────────────────────────────────────────────────┐
│ EMERGENT DEPLOYMENT (production)                        │
│ frontend → https://gen-c-health.emergent.host           │
│ backend  → https://gen-c-health.emergent.host/api       │
│ database → MongoDB Atlas (cloud, shared or separate)    │
└─────────────────────────────────────────────────────────┘
```

You can edit code locally and redeploy as many times as you want before defense day.

---

## What to do for thesis defense

1. **Open your deployed URL** in a browser on the panel's projector. Show login → admin dashboard → register doctor → upload file → anchor Merkle root → cost-savings chart.
2. **Show the URL bar** with HTTPS padlock as proof it's a real domain.
3. **Open `/api/`** in another tab → shows the live backend running.
4. **Hand the panel your laptop / phone** to open the URL themselves. Real public domain = panel can browse from their seat.
5. **Backup**: if internet fails, run locally (Part B) as fallback. Same exact app, same database (if using Atlas).

---

## Project structure

```
genc-health/
├── backend/
│   ├── server.py              FastAPI application (all routes)
│   ├── requirements.txt       Python dependencies
│   ├── tests/                 pytest suite (56 tests)
│   └── .env                   (YOU create this — NOT in Git)
├── frontend/
│   ├── src/
│   │   ├── pages/             Login, Onboarding, Admin/Doctor/Patient dashboards
│   │   ├── components/        Layout, LpaCostChart, MerkleVisualizer, ui/...
│   │   └── lib/               walletContext, crypto, api
│   ├── package.json
│   ├── craco.config.js        Webpack overrides (@/ alias)
│   └── .env                   (YOU create this — NOT in Git)
├── memory/                    PRD and test credentials
├── README.md
└── SETUP.md                   this file
```

Good luck with your defense! 🛡️
