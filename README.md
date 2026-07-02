# RFQ Dashboard

[![CI](https://github.com/dvirchakim/DvirRfqSystem/actions/workflows/ci.yml/badge.svg)](https://github.com/dvirchakim/DvirRfqSystem/actions/workflows/ci.yml)

An AI-powered procurement automation dashboard for electronic components distributors. Processes incoming RFQ emails, extracts structured data using an LLM, manages supplier outreach, and tracks the full procurement pipeline. Built for a Hebrew/English bilingual workflow but the parsing prompts and UI are all in English and easy to adapt to any market.

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
2. Build the container image from `dashboard-app/Dockerfile`
3. Start the container on port **8080**
4. Open `http://localhost:8080` in your browser

Re-run `setup.ps1` any time you pull new code — it rebuilds and restarts the container.

> **Requirement:** Docker Desktop must be running before the build step. The script will attempt to start it automatically.

---

### Linux / macOS — clone and run

```bash
git clone https://github.com/dvirchakim/DvirRfqSystem.git
cd DvirRfqSystem/dashboard-app
docker compose up -d --build
```

Opens at **http://localhost:8080**.

---

### Local dev (no Docker)

```bash
cd dashboard-app
npm install
npm run dev
```

Open **http://localhost:5173**

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
dashboard-app/
├── src/
│   ├── LiveRFQDashboard.jsx   # Main app (dashboard, pipeline, config, test, logs)
│   ├── llmClient.js           # Multi-provider LLM client + supplier scoring + FX conversion
│   ├── mailProviders.js       # Gmail + Outlook API integrations
│   ├── exportUtils.js         # Excel + PDF export + escapeHtml
│   ├── emailTemplates.js      # Outbound HTML email builders (supplier RFQ, follow-up)
│   ├── emlParser.js           # .eml file parser (quoted-printable, base64, Hebrew)
│   ├── prompts.js             # LLM prompts (inbound RFQ parsing, supplier response parsing)
│   ├── constants.js           # Pipeline status metadata
│   ├── icons.jsx              # Inline SVG icon set
│   └── *.test.js              # Vitest unit tests
├── public/
│   ├── example-mails/         # Sample RFQ emails for testing (not committed)
│   └── supplier-mails/        # Sample supplier response emails (not committed)
├── Dockerfile
├── docker-compose.yml
└── nginx.conf
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

## Security notes

This is a **client-side-only** application by design — there is no backend server, and no RFQ data or API keys ever leave your browser except for direct calls to the LLM/mail providers you configure. That tradeoff comes with caveats worth knowing before you deploy it:

- API keys (Anthropic / OpenAI-compatible / OpenRouter) and mail OAuth client IDs are stored in **browser `localStorage` in plaintext**. Anyone with access to the browser profile (or an XSS vector) can read them. Don't deploy this on a shared/public machine, and don't commit real keys anywhere in the repo.
- RFQ content comes from untrusted inbound email and is parsed by an LLM; downstream rendering (PDF export, supplier email preview) HTML-escapes all extracted fields to prevent injection, but treat any further UI additions that render RFQ fields with the same care.
- For a multi-user or production deployment, put a thin backend in front of the LLM/mail calls so API keys never reach the browser at all.

## License

MIT — see [LICENSE](LICENSE). This is a generic starting point; company name, prompts, and sample data should be adapted to your own organization before production use.
