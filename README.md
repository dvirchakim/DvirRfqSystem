# rfq RFQ Dashboard

An AI-powered procurement automation dashboard for **rfq Projects** — an Israeli electronic components distributor. Processes incoming RFQ emails, extracts structured data using Claude AI, manages supplier outreach, and tracks the full procurement pipeline.

---

<img width="1868" height="563" alt="image" src="https://github.com/user-attachments/assets/fe859513-0294-43b4-a89a-7c4801a6b6c4" />



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
git clone https://github.com/dvirchakim/DvirRfqSystem.git
cd DvirRfqSystem
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
│   ├── llmClient.js           # Multi-provider LLM client + supplier scoring
│   ├── mailProviders.js       # Gmail + Outlook API integrations
│   ├── exportUtils.js         # Excel + PDF export
│   └── emlParser.js           # .eml file parser (quoted-printable, base64, Hebrew)
├── public/
│   ├── example-mails/         # Sample RFQ emails for testing (not committed)
│   └── supplier-mails/        # Sample supplier response emails (not committed)
├── Dockerfile
├── docker-compose.yml
└── nginx.conf
```

---

## License

Private — rfq Projects internal tooling.
