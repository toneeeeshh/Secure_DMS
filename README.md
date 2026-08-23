# Secure Digital Document Management System (Prototype)

A working prototype of a secure DMS for FIRs, investigation records, witness
statements, charge sheets, court filings, evidence records, forensic reports,
and legal notices/judgments.

## Features implemented

- **Authentication** — login, logout (audit-logged), session handling via JWT, "who am I" identity check.
- **Role-Based Access Control** — 5 roles: Administrator, Police Officer,
  Investigator, Forensic Expert, Legal/Prosecution Officer.
- **Case Management** — create a case, list/search cases you're a member of,
  open a case to see its documents, add/remove authorized members (case
  creator or admin only).
- **Document Management** — upload into a case, auto-generated human-readable
  Document ID (`DOC-000001`, ...), metadata (type/tags/description) and file
  stored together, full document detail view.
- **Integrity** — SHA-256 hash generated and digitally signed (RSA-2048) at
  upload; "Verify" recomputes the hash live and displays **VERIFIED** or
  **INTEGRITY COMPROMISED**.
- **Tamper Demonstration** — a dedicated, safe demo action: preserves the
  real file untouched, creates a throwaway copy, modifies only the copy,
  hashes it, and shows the hash mismatch side-by-side — for live demos
  without ever risking real evidence.
- **Audit Trail** — every LOGIN, LOGOUT, CASE_CREATED, DOCUMENT_UPLOADED,
  DOCUMENT_VIEWED, DOCUMENT_DOWNLOADED, DOCUMENT_VERIFIED, ACCESS_GRANTED,
  ACCESS_DENIED, DOCUMENT_TAMPER_DETECTED, and PERMISSION_CHANGED event is
  recorded with actor, timestamp, and IP.
- **Tamper-Evident Audit Chain** — every audit entry stores the hash of the
  entry before it (the same core idea blockchain is built on). An admin can
  click "Verify Audit Chain Integrity" to recompute the whole chain and
  confirm nothing was altered, reordered, or deleted — tested by directly
  editing a past log entry and confirming the break is detected.
- **Search** — by case ID, case name, document ID, and file name.
- **Security Alerts** — an admin-only feed surfacing unauthorized access
  attempts ("Unauthorized access attempt detected.") and detected tampering.
- **Version control** — every re-upload is a new, separately hashed and
  signed version; nothing is ever overwritten.
- **Soft-delete / archival** — admins can archive a document; the file and
  its full audit history are retained rather than destroyed.

## Production hardening in this version

- **Real database**: SQLite via `better-sqlite3` (was a JSON file in the
  earlier prototype) — proper schema, indexes, and transactional writes.
- **HTTPS enforced** in production mode (redirects plain HTTP to HTTPS,
  and sets `Strict-Transport-Security`).
- **Security headers** via Helmet (CSP, frame protections, etc).
- **Rate limiting** on login and the one-time bootstrap route (10
  attempts / 15 minutes) to slow down password guessing.
- **JWT_SECRET required from environment** in production — the server
  refuses to start in production mode if it isn't set, instead of silently
  falling back to a default.

## Tech stack

- **Backend**: Node.js + Express
- **Database**: SQLite (`better-sqlite3`)
- **Auth**: JWT sessions, bcrypt-hashed passwords, rate-limited login
- **File handling**: Multer (in-memory, written to per-document folders)
- **Integrity/signing**: Node's built-in `crypto` module (SHA-256 + RSA-2048)
- **Security**: Helmet, HTTPS enforcement
- **Frontend**: Vanilla HTML/CSS/JS (no build step required)

## Running it locally

```bash
cd secure-dms
npm install
npm start
```

Open **http://localhost:4000**. Since no users exist yet, you'll be
prompted to create the first administrator account.

## Deploying so others can reach it

### Option A — Render.com (recommended, easiest)

The included `render.yaml` is set up for the **free tier** — good for demos.
1. Push this folder to a GitHub repository (see "Getting this onto GitHub" below).
2. Go to [render.com](https://render.com) and sign up / log in.
3. Click **New +** → **Blueprint**, and point it at your GitHub repo. Render
   will detect `render.yaml` and configure everything automatically,
   including generating a secure `JWT_SECRET` for you, on the free plan.
4. Click **Apply**. After the build finishes you'll get a public URL like
   `https://secure-dms.onrender.com`.

   ⚠️ Free tier has no persistent disk — the database and any uploaded
   files reset whenever the app restarts (after ~15 minutes of inactivity,
   and on every redeploy). Great for showing people a live demo; not for
   storing real documents long-term.

   **To make data persist**, upgrade to a paid instance type in the Render
   dashboard (Settings → Instance Type), then add a disk (Disks tab) mounted
   at `/var/data`, and set two environment variables pointing at it:
   `DATA_DIR=/var/data/data` and `UPLOAD_DIR=/var/data/uploads`.

### Option B — Railway.app

1. Push the folder to GitHub.
2. On [railway.app](https://railway.app), **New Project** → **Deploy from
   GitHub repo**.
3. In the service's **Variables** tab, add:
   - `NODE_ENV=production`
   - `JWT_SECRET=` (generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
4. Add a **Volume** and mount it (e.g. at `/data`), then set:
   - `DATA_DIR=/data/data`
   - `UPLOAD_DIR=/data/uploads`
   so your database and files persist across deploys.
5. Railway gives you a public URL automatically.

### Option C — Your own server (VPS)

For a small ongoing cost (~$5-6/month on DigitalOcean, Hetzner, AWS
Lightsail, etc.) you get a real machine that never wipes its disk:

1. Create the smallest Ubuntu server and SSH into it.
2. Install Node.js (`https://github.com/nodesource/distributions`).
3. Copy this project to the server (`scp` or `git clone`).
4. Create a real `.env` file from `.env.example` with a strong `JWT_SECRET`
   and `NODE_ENV=production`.
5. `npm install --omit=dev && npm install pm2 -g`
6. `pm2 start server.js --name secure-dms` — keeps it running permanently
   and restarts it if it crashes or the server reboots.
7. Put a reverse proxy (Nginx or Caddy) in front of it with a free TLS
   certificate from Let's Encrypt, and optionally point a domain name at it.

### Getting this onto GitHub (needed for Options A & B)

```bash
cd secure-dms
git init
git add .
git commit -m "Secure DMS prototype"
```
Then create an empty repository on github.com, and run the two commands
GitHub shows you (something like):
```bash
git remote add origin https://github.com/<your-username>/secure-dms.git
git branch -M main
git push -u origin main
```

## Project structure

```
secure-dms/
  server.js                 # Express app entry point (helmet, HTTPS, routes)
  routes/
    auth.js                  # bootstrap, login (rate-limited), /me
    users.js                 # admin user management
    documents.js              # create/search/version/download/verify/delete
    audit.js                  # system-wide audit log (admin)
  middleware/auth.js         # JWT verification + role guard
  utils/
    db.js                     # SQLite connection + schema
    repo.js                   # typed data-access helpers over SQLite
    security.js               # hashing, RSA keypair, sign/verify
    roles.js                  # role & permission logic
  public/                    # frontend (HTML/CSS/JS)
  data/                      # dms.sqlite + generated signing keys (gitignored)
  uploads/                   # stored document versions, per document folder
  render.yaml                # Render.com deployment blueprint
  .env.example                # environment variable template
```

## Notes on scaling this further

- **Postgres**: for multiple servers / very high concurrency, swap
  `better-sqlite3` for a hosted Postgres (e.g. Render/Railway/Neon offer
  free tiers) — the `repo.js` layer isolates all SQL, so this is a
  contained change.
- **Encrypted object storage**: move file storage from local disk to
  S3-compatible storage with server-side encryption at rest.
- **HSM / CA-issued signing certificate**: replace the self-managed RSA
  key pair with one issued and protected by a real Certificate Authority
  or Hardware Security Module.
- **2FA / SSO**: add multi-factor authentication for law-enforcement
  accounts, ideally via an identity provider.
- **Blockchain hash-anchoring**: optionally anchor each document's hash to
  a permissioned ledger (e.g. Hyperledger Fabric) as an additional,
  independently-auditable tamper-evidence layer beyond the signature
  scheme already implemented here.
- **Full-text/OCR search**: a dedicated search index (Elasticsearch/
  OpenSearch) for large-scale keyword and scanned-document search.
"# Secure_DMS" 
"# Secure_DMS" 
