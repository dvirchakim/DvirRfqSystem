# Outlook Integration

The dashboard connects to Outlook / Microsoft 365 using **MSAL** (Microsoft Authentication Library) with the Microsoft Graph API. No backend required.

---

## Scopes requested

| Scope | Purpose |
|---|---|
| `Mail.Read` | Read and list incoming RFQ emails |
| `Mail.Send` | Send supplier outreach emails and follow-ups |
| `User.Read` | Identify the signed-in user |

---

## Setup: Azure Portal

### 1. Register an app

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory → App registrations → New registration**
2. Name: `RFQ Dashboard`
3. Supported account types: choose based on your org:
   - **Single tenant** — only your org's accounts (most secure for internal tools)
   - **Multitenant** — any Microsoft account
   - **Multitenant + personal** — includes personal Outlook.com accounts
4. Redirect URI: select **Single-page application (SPA)** and enter:
   - `http://localhost:8080` (Docker)
   - `http://localhost:5173` (local dev)
   - Your production URL if deployed
5. Click **Register** — copy the **Application (client) ID** and **Directory (tenant) ID**

### 2. Add API permissions

1. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**
2. Add: `Mail.Read`, `Mail.Send`, `User.Read`
3. Click **Grant admin consent** (if you have admin rights) — or ask your IT admin to do this

### 3. Configure the dashboard

1. In the Config tab → **Mail Provider** → select **Outlook**
2. Paste your **Client ID** (Application ID) into the Microsoft Client ID field
3. Paste your **Tenant ID** into the Tenant ID field
   - Leave blank or enter `common` for multi-tenant / personal accounts
4. Click **התחבר ל-Outlook** — a Microsoft sign-in popup will appear

---

## Tenant ID guidance

| Your situation | Tenant ID field |
|---|---|
| Company Microsoft 365 account | Your directory GUID (e.g. `abc123...`) or domain (e.g. `contoso.onmicrosoft.com`) |
| Personal Outlook.com account | Leave blank (uses `common`) |
| Mixed (both org + personal) | Leave blank (uses `common`) |

---

## How it works

- **Polling**: Queries `https://graph.microsoft.com/v1.0/me/messages` with your search query, ordered by `receivedDateTime DESC`
- **Token refresh**: MSAL handles silent token refresh automatically. If that fails, a popup is shown
- **Send**: Uses `https://graph.microsoft.com/v1.0/me/sendMail` with HTML body and `saveToSentItems: true`
- **Sign-out**: Use the **התנתק** button in Config → clears MSAL cache from localStorage

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Popup blocked | Allow popups for `localhost` in your browser |
| AADSTS65001 (consent needed) | Admin consent not yet granted — ask your IT admin or use a personal account |
| AADSTS700016 (app not found) | Check the Client ID is correct and the redirect URI matches exactly |
| Token silently fails | Click **נקה MSAL** button in Config, then reconnect |
| Wrong account | Click **נקה MSAL** to clear cached accounts, then sign in again |
| Mail.Send 403 | The `Mail.Send` scope wasn't consented — click the connect button again to re-consent |
