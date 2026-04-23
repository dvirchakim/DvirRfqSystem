# Setup & Installation

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | For local dev only |
| Docker Desktop | Any recent | For containerized run |
| A modern browser | Chrome / Edge / Firefox | Safari has known OAuth popup issues |

---

## Option A — Docker (recommended for production)

### 1. Clone the repo

```bash
git clone https://github.com/dvirchakim/DvirRfqSystem.git
cd DvirRfqSystem/dashboard-app
```

### 2. Start the container

```bash
docker compose up -d
```

Docker will:
- Pull `node:20-alpine` and build the Vite app inside the container
- Serve the static bundle via `nginx:1.27-alpine` on port 8080

### 3. Open the app

```
http://localhost:8080
```

### Updating to a new version

```bash
docker compose down
git pull
docker compose build --no-cache
docker compose up -d
```

---

## Option B — Local dev server

### 1. Install dependencies

```bash
cd dashboard-app
npm install
```

### 2. Start Vite

```bash
npm run dev
```

App runs at **http://localhost:5173** with hot-reload.

### 3. Production build (optional)

```bash
npm run build
# Output goes to dashboard-app/dist/
```

---

## First-time configuration

Once the app is open, go to the **⚙ הגדרות** (Config) tab and set:

1. **LLM Provider** — choose Anthropic, OpenAI-compatible, or Ollama and enter your API key/URL. See [LLM Configuration](llm-config.md).
2. **Mail Provider** — connect Gmail or Outlook. See [Gmail](gmail-integration.md) or [Outlook](outlook-integration.md).
3. **Supplier List** — add supplier name + email pairs. See [Supplier Workflow](supplier-workflow.md).

All settings are saved automatically to `localStorage` in your browser — they persist across page refreshes.

---

## Port configuration

To change the port, edit `docker-compose.yml`:

```yaml
ports:
  - "3000:80"   # change 3000 to any available port
```

Then restart: `docker compose up -d`
