# Gmail Integration

The dashboard connects to Gmail using **Google Identity Services** (OAuth 2.0 in-browser token flow). No backend required. The access token lives in memory only and is never stored.

---

## Scopes requested

| Scope | Purpose |
|---|---|
| `gmail.readonly` | Read and list incoming RFQ emails |
| `gmail.send` | Send supplier outreach emails and follow-ups |

---

## Setup: Google Cloud Console

### 1. Create a project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. **rfq RFQ**)

### 2. Enable the Gmail API

1. Navigate to **APIs & Services → Library**
2. Search for **Gmail API** and click **Enable**

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** (or Internal if your org uses Google Workspace)
3. Fill in the app name (e.g. `rfq RFQ Dashboard`) and your email
4. Under **Scopes**, add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
5. Under **Test users**, add your Gmail address (required while the app is in testing mode)
6. Save

### 4. Create OAuth credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Under **Authorized JavaScript origins**, add:
   - `http://localhost:8080` (Docker)
   - `http://localhost:5173` (local dev)
   - Your production URL if deployed
4. Click **Create** — copy the **Client ID**

### 5. Configure the dashboard

1. In the Config tab → **Mail Provider** → select **Gmail**
2. Paste your **Client ID** into the Google Client ID field
3. Click **התחבר ל-Gmail** — a Google sign-in popup will appear
4. Sign in and grant the requested permissions

---

## How it works

- **Polling**: When the pipeline is running, the dashboard queries Gmail using your search query (default: `subject:(RFQ OR הצעת מחיר) newer_than:7d`) every N seconds (configurable)
- **Parsing**: Each new email is fetched in raw format, decoded (base64/quoted-printable), and sent to the LLM for extraction
- **Follow-up**: If a parsed RFQ has no delivery date, an automatic Hebrew follow-up email is sent to the original sender
- **Outreach**: When you click "שלח לספקים", supplier emails are sent from your connected Gmail account

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Popup blocked | Allow popups for `localhost` in Chrome settings |
| "Access blocked" error | Add your email to Test Users in the OAuth consent screen |
| Token expired | Click **התחבר ל-Gmail** again — tokens expire after 1 hour |
| Wrong account signed in | Sign out of Google in the browser and reconnect |
| Send fails with 403 | Make sure you granted the `gmail.send` scope during sign-in (click consent again if needed) |
