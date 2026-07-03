# RFQ Dashboard

[![CI](https://github.com/dvirchakim/DvirRfqSystem/actions/workflows/ci.yml/badge.svg)](https://github.com/dvirchakim/DvirRfqSystem/actions/workflows/ci.yml)

An AI-powered procurement automation dashboard for electronic components distributors. Processes incoming RFQ emails, extracts structured data using an LLM, manages supplier outreach, and tracks the full procurement pipeline. Includes an **embedded AI agent** that can answer questions about your live RFQ data and reshape the dashboard on request. Built for a Hebrew/English bilingual workflow but the parsing prompts and UI are all in English and easy to adapt to any market.

---

## Features

| Feature | Description |
|---|---|
| **AI Email Parsing** | Extracts part numbers, quantities, prices, delivery dates, and customer names from Hebrew/English RFQ emails |
| **Live Inbox Integration** | Connects to Gmail or Outlook — polls for new RFQs automatically |
| **Supplier Outreach** | Sends formatted RFQ emails to a managed supplier list via your connected mailbox |
| **Supplier Response Scoring** | Parses supplier reply emails and scores them 0–100 (price, lead time, availability) |
| **Pipeline Tracking** | Full status workflow: `new → processing → parsed → ready → distributed → awaiting → completed` |
| **Obsolete Detection** | Detects OBS/EOL/NRND parts from Hebrew and English variants, flags rows and detail panel |
| **Export** | Export selected RFQs to Excel (.xlsx) or PDF (print-ready Hebrew RTL layout) |
| **Multi-Provider LLM** | Works with Anthropic Claude, OpenRouter (300+ models), any OpenAI-compatible API, or local Ollama |
| **Human-in-Loop Flag** | Mark any RFQ for manual review before supplier emails are sent |
| **Audit Trail** | Every pipeline step-back requires a comment, stored in status history |
| **Persistent Storage** | All RFQs and config survive page refresh via localStorage |

---

## Quick Start

### Windows — clone and run

```powershell
# 1. Install Git (skip if already installed)
winget install --id Git.Git -e --source winget

# 2. Clone the repo
git clone https://github.com/dvirchakim/DvirRfqSystem.git
cd DvirRfqSystem

# 3. Allow PowerShell scripts (one-time, no admin required)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 4. Run setup
.\setup.ps1
```

`setup.ps1` will:
1. Install **Docker Desktop** automatically (via `winget`) if it isn't already installed
2. Generate a `.env` with fresh, random secrets on first run (never overwritten on re-runs)
3. Build and start the full stack — dashboard + AI-agent backend + PostgreSQL — with `docker compose`
4. Open `http://localhost:8080` in your browser

Re-run `setup.ps1` any time you pull new code — it rebuilds and restarts the stack, and never overwrites your existing `.env`.

> **Requirement:** Docker Desktop must be running before the build step. The script will attempt to start it automatically.

---

### Linux / macOS — clone and run

```bash
curl -fsSL https://raw.githubusercontent.com/dvirchakim/DvirRfqSystem/main/deploy.sh | bash
```

Or manually:

```bash
git clone https://github.com/dvirchakim/DvirRfqSystem.git
cd DvirRfqSystem
docker compose up -d --build   # deploy.sh (above) generates .env with random secrets first;
                                # doing it manually, copy env.example.txt to .env yourself first
```

Opens at **http://localhost:8080**. The compose file runs all three services (frontend, backend, PostgreSQL) from the repo root — run compose from the root, not from `dashboard-app/`.

> The **AI Agent** connects automatically — no token to paste, no separate LLM key to set up. It authenticates to the backend with a token baked into the build at `docker compose` time, and it reuses whichever LLM provider you've already configured in **Settings** (Anthropic / OpenAI-compatible / Ollama / OpenRouter) for RFQ parsing. The dashboard itself works with none of this if you skip Docker entirely.

---

### Just the dashboard (no AI agent, no Docker)

The RFQ dashboard runs fully in the browser and needs no backend:

```bash
cd dashboard-app
npm install
npm run dev
```

Open **http://localhost:5173**. The AI Agent tab will show but stay disconnected until you run the backend (via `docker compose`).

---

## Docs

| Guide | Description |
|---|---|
| [Setup & Installation](docs/setup.md) | Local dev, Docker, environment requirements |
| [LLM Configuration](docs/llm-config.md) | Anthropic, OpenAI-compatible, and Ollama setup |
| [Gmail Integration](docs/gmail-integration.md) | Google OAuth setup, scopes, troubleshooting |
| [Outlook Integration](docs/outlook-integration.md) | Azure AD app registration, MSAL setup |
| [Supplier Workflow](docs/supplier-workflow.md) | Managing the supplier list, sending RFQs, scoring responses |
| [Pipeline Reference](docs/pipeline.md) | Status flow, backward step, human-in-loop, audit trail |
| [Deployment](docs/deployment.md) | Docker, Netlify, Cloudflare Pages |

---

## Tech Stack

- **Frontend**: React 18, Vite
- **AI**: Anthropic Claude API (`claude-sonnet-4-6`), OpenAI-compatible, Ollama
- **Mail**: Gmail API (Google Identity Services), Microsoft Graph API (MSAL)
- **Export**: SheetJS (xlsx), browser print window
- **Deployment**: Docker + nginx, or any static host

---

## Project Structure

```
docker-compose.yml             # Full stack: frontend + backend + PostgreSQL
env.example.txt                # Copy to .env and fill in secrets
dashboard-app/                 # React frontend (dashboard + AI Agent tab)
├── src/
│   ├── LiveRFQDashboard.jsx   # Main app (dashboard, pipeline, config, test, AI agent)
│   ├── ChatTab.jsx            # AI Agent chat UI (SSE streaming, live layout preview)
│   ├── layoutEngine.jsx       # Renders the agent-composed widget layout
│   ├── widgets/               # Agent-composable widgets (stats, charts, metrics, tables…)
│   ├── llmClient.js           # Multi-provider LLM client + supplier scoring + FX conversion
│   ├── mailProviders.js       # Gmail + Outlook API integrations
│   ├── exportUtils.js         # Excel + PDF export + escapeHtml
│   ├── emailTemplates.js      # Outbound HTML email builders (supplier RFQ, follow-up)
│   ├── emlParser.js           # .eml file parser (quoted-printable, base64, Hebrew)
│   ├── prompts.js             # LLM prompts (inbound RFQ parsing, supplier response parsing)
│   ├── constants.js           # Pipeline status metadata
│   ├── icons.jsx              # Inline SVG icon set
│   └── *.test.js              # Vitest unit tests
├── Dockerfile
└── nginx.conf                 # Serves the SPA, proxies /api to the backend
backend/                       # AI-agent backend (Node + Express + PostgreSQL)
├── server.js                  # Auth, rate limiting, SSE chat, agent tool calls
├── widgetSchema.js            # Single source of truth for the agent's UI vocabulary
├── tools/                     # execute_readonly_sql, validateLayout (+ tests)
├── db.js · schema.sql         # Read-write + read-only (SELECT-only) DB roles
└── init-agent-password.sh     # Sets the read-only role's password from AGENT_DB_PASSWORD
```

---

## Development

```bash
cd dashboard-app
npm install
npm run lint     # ESLint
npm run test     # Vitest unit tests
npm run build    # Production build
```

CI runs lint, tests, and build on every push/PR to `main` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

---

## Architecture & Security notes

The **dashboard** (RFQ pipeline, parsing, supplier outreach) runs entirely in the browser — no backend is required for it, and RFQ data / API keys never leave your browser except for direct calls to the LLM and mail providers you configure. The optional **AI Agent** adds a small Node + PostgreSQL backend (`backend/`, wired up by `docker-compose.yml`) that the agent uses to query RFQ data and reshape the dashboard.

Security properties worth knowing before you deploy:

- **API keys in the browser.** LLM keys (Anthropic / OpenAI-compatible / OpenRouter) and mail OAuth client IDs are stored in **`localStorage` in plaintext**. Anyone with access to the browser profile (or an XSS vector) can read them. Don't deploy on a shared/public machine, and never commit real keys.
- **RFQ content is untrusted.** It comes from inbound email and is parsed by an LLM; all downstream HTML rendering (PDF export, supplier email preview, agent-authored cards) escapes extracted fields to prevent injection. Keep that discipline for any new UI that renders RFQ fields.
- **The agent backend requires a token, but you don't configure it.** It refuses to start without `BACKEND_API_TOKEN` set (or `ALLOW_UNAUTHENTICATED=true` for local-only use), and every `/api` route except health requires that Bearer token. `setup.ps1`/`deploy.sh` generate it randomly into `.env`, and `docker-compose.yml` bakes the same value into the frontend build (`VITE_BACKEND_API_TOKEN`) — there's nothing to paste. It's only visible client-side (baked into the JS bundle), so it stops arbitrary internet traffic from hitting the API, not a determined user of the app itself; treat it as a deployment-boundary control, not a per-user secret.
- **The agent reuses your existing LLM provider** — whichever one you configured in Settings for RFQ parsing (Anthropic / OpenAI-compatible / Ollama / OpenRouter) is what the agent calls; there's no separate agent-only key. An optional `OPENROUTER_API_KEY` in `.env` exists only if a deployer wants to provide a shared fallback key.
- **The agent's SQL access is read-only, enforced three ways:** a dedicated `rfq_agent` Postgres role with SELECT-only grants, a `READ ONLY` transaction with a statement timeout, and an app-level statement/keyword filter. The agent's UI changes are declarative — it composes a fixed, schema-validated set of widgets and can never execute arbitrary code.
- For a hardened production deployment, also put the LLM/mail calls behind the backend so provider keys never reach the browser at all.

## License

MIT — see [LICENSE](LICENSE). This is a generic starting point; company name, prompts, and sample data should be adapted to your own organization before production use.
