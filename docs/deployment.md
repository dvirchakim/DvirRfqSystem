# Deployment

This is a fully static single-page application — no server, no database. All you need is something that can serve static files.

---

## Option A — Docker (self-hosted)

Best for running on your own machine or a private server.

### Local machine

```bash
cd dashboard-app
docker compose up -d
# App available at http://localhost:8080
```

### Remote server (e.g. VPS, company server)

```bash
# On the server
git clone https://github.com/dvirchakim/DvirRfqSystem.git
cd DvirRfqSystem/dashboard-app
docker compose up -d
# App available at http://<server-ip>:8080
```

To expose it on port 80/443 with a domain, put a reverse proxy (nginx, Caddy, Traefik) in front of the container.

### Updating

```bash
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## Option B — Netlify (drag and drop, free)

### Steps

1. Build the app locally:
   ```bash
   cd dashboard-app
   npm install
   npm run build
   ```
2. Go to [netlify.com](https://netlify.com) and sign in
3. Scroll to the **"Deploy manually"** drop zone at the bottom of the dashboard
4. Drag the `dashboard-app/dist/` folder onto the drop zone
5. Done — Netlify gives you a URL like `https://random-name.netlify.app`

### Using the deploy zip

If you have a prebuilt `rfq-dashboard-deploy.zip` file:
1. Go to Netlify → Sites → drag and drop the zip file

### Custom domain

In Netlify → Site settings → Domain management → add your domain.

---

## Option C — Cloudflare Pages

1. Go to [Cloudflare dashboard](https://dash.cloudflare.com) → Pages → Create a project → **Upload assets**
2. Drag the `dist/` folder or zip
3. Deploy

---

## Option D — Vercel

```bash
cd dashboard-app
npm install -g vercel
vercel --prod
```

Or drag the `dist/` folder in the Vercel web dashboard.

---

## CORS and API keys

Since all API calls (Anthropic, Gmail, Outlook) go directly from the browser:

- **No CORS proxy needed** — APIs are called with appropriate browser-compatible headers
- **API keys live only in the user's browser localStorage** — they are never sent to any server you control
- **Gmail/Outlook OAuth** uses in-browser token flows — tokens live in memory only

### Authorized origins

When deploying to a non-localhost URL, you must add it to:
- **Google Cloud Console** → OAuth 2.0 Client → Authorized JavaScript origins
- **Azure Portal** → App registration → Authentication → Redirect URIs (SPA)

---

## nginx configuration

The included `nginx.conf` handles SPA routing — all paths fall back to `index.html`:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

This is required for any static host. Netlify and Cloudflare Pages handle this automatically. If self-hosting with a different web server, add the equivalent rewrite rule.

---

## Production checklist

- [ ] LLM provider configured and tested
- [ ] Gmail or Outlook client ID registered with your production URL as an authorized origin
- [ ] Supplier list populated in Config tab
- [ ] Test tab used to verify AI parsing on a real email
- [ ] Docker container healthy (`docker ps` shows `(healthy)`)
