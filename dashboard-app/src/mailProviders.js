// Gmail (Google Identity Services) and Outlook (MSAL + Microsoft Graph) integrations.
// All flows are browser-only (no backend). Tokens live in memory only.

import { PublicClientApplication } from "@azure/msal-browser";

// ─────────────── GOOGLE IDENTITY SERVICES (Gmail) ───────────────

let gisLoaded = null;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

export async function gmailSignIn(clientId) {
  if (!clientId) throw new Error("Google Client ID is required");
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      // Include send scope so follow-up emails and supplier distribution work
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      callback: (response) => {
        if (response.error) return reject(new Error(response.error));
        resolve(response.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || "Google sign-in failed")),
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export async function gmailListMessages(token, q = "", max = 20) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(max));
  const listRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);
  const listData = await listRes.json();
  const ids = (listData.messages || []).map(m => m.id);

  const details = await Promise.all(ids.map(id =>
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json())
  ));

  return details.map(m => {
    const headers = Object.fromEntries((m.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
    return {
      id: m.id,
      from: headers.from || "",
      subject: headers.subject || "(no subject)",
      date: headers.date || "",
      snippet: m.snippet || "",
    };
  });
}

export async function gmailFetchRaw(token, id) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail raw fetch failed: ${res.status}`);
  const data = await res.json();
  const b64 = (data.raw || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

// Send an email via Gmail API (requires gmail.send scope)
export async function gmailSendMessage(token, to, subject, htmlBody) {
  const encoder = new TextEncoder();

  // Base64-encode subject for MIME header (handles Hebrew)
  const subjectB64 = btoa(unescape(encodeURIComponent(subject)));

  // Base64-encode HTML body
  const bodyBytes = encoder.encode(htmlBody);
  let bodyBin = '';
  bodyBytes.forEach(b => bodyBin += String.fromCharCode(b));
  const bodyB64 = btoa(bodyBin);

  const mimeMsg = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${subjectB64}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    bodyB64,
  ].join('\r\n');

  // Base64url-encode the full MIME message
  const msgBytes = encoder.encode(mimeMsg);
  let msgBin = '';
  msgBytes.forEach(b => msgBin += String.fromCharCode(b));
  const b64url = btoa(msgBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gmail send failed: ${res.status} — ${err}`);
  }
  return await res.json();
}

// ─────────────── MICROSOFT GRAPH (Outlook) via MSAL ───────────────

let msalInstance = null;
let msalClientIdUsed = null;
let msalInitPromise = null;
let msalTenantIdUsed = null;

export function initOutlook(clientId, tenantId) {
  if (!clientId) return Promise.reject(new Error("Microsoft Client ID is required"));
  const tenant = tenantId && tenantId.trim() ? tenantId.trim() : "common";
  if (msalInstance && msalClientIdUsed === clientId && msalTenantIdUsed === tenant) return msalInitPromise;
  msalInstance = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenant}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: "localStorage" },
  });
  msalClientIdUsed = clientId;
  msalTenantIdUsed = tenant;
  msalInitPromise = msalInstance.initialize();
  return msalInitPromise;
}

function requireInitialized() {
  if (!msalInstance) {
    throw new Error("MSAL not initialized yet — please wait a moment or check that the Microsoft Client ID is set");
  }
  return msalInstance;
}

// Include Mail.Send scope for outgoing emails
const GRAPH_SCOPES = ["Mail.Read", "Mail.Send", "User.Read"];

export async function outlookSignIn(clientId, tenantId) {
  const tenant = tenantId && tenantId.trim() ? tenantId.trim() : "common";
  if (!msalInstance || msalClientIdUsed !== clientId || msalTenantIdUsed !== tenant) {
    await initOutlook(clientId, tenantId);
  }
  const msal = requireInitialized();
  const result = await msal.loginPopup({ scopes: GRAPH_SCOPES, prompt: "select_account" });
  msal.setActiveAccount(result.account);
  return await acquireOutlookToken(clientId, tenantId);
}

export async function acquireOutlookToken(clientId, tenantId) {
  const tenant = tenantId && tenantId.trim() ? tenantId.trim() : "common";
  if (!msalInstance || msalClientIdUsed !== clientId || msalTenantIdUsed !== tenant) {
    await initOutlook(clientId, tenantId);
  }
  const msal = requireInitialized();
  const account = msal.getActiveAccount() || msal.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in to Microsoft");
  msal.setActiveAccount(account);
  try {
    const r = await msal.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
    return r.accessToken;
  } catch {
    const r = await msal.acquireTokenPopup({ scopes: GRAPH_SCOPES });
    return r.accessToken;
  }
}

export async function outlookListMessages(token, q = "", max = 20) {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$top", String(max));
  url.searchParams.set("$select", "id,subject,from,receivedDateTime,bodyPreview");
  url.searchParams.set("$orderby", "receivedDateTime DESC");
  if (q) url.searchParams.set("$search", `"${q}"`);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
  });
  if (!res.ok) throw new Error(`Outlook list failed: ${res.status}`);
  const data = await res.json();
  return (data.value || []).map(m => ({
    id: m.id,
    from: m.from?.emailAddress?.address ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address}>` : "",
    subject: m.subject || "(no subject)",
    date: m.receivedDateTime || "",
    snippet: m.bodyPreview || "",
  }));
}

export async function outlookFetchMessage(token, id) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}?$select=subject,from,toRecipients,receivedDateTime,body`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Outlook fetch failed: ${res.status}`);
  const m = await res.json();
  const from = m.from?.emailAddress?.address ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address}>` : "";
  const to = (m.toRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(", ");
  let bodyText = m.body?.content || "";
  if (m.body?.contentType === "html") {
    bodyText = bodyText
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<\/?(p|br|div|tr|li|h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return {
    from, to,
    subject: m.subject || "",
    date: m.receivedDateTime || "",
    body: bodyText,
    formatted: `From: ${from}\nTo: ${to}\nSubject: ${m.subject || ""}\nDate: ${m.receivedDateTime || ""}\n\n${bodyText}`,
  };
}

// Send an email via Microsoft Graph (requires Mail.Send scope)
export async function outlookSendMessage(token, to, subject, htmlBody) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Outlook send failed: ${res.status} — ${err}`);
  }
}

export async function outlookSignOut(clientId, tenantId) {
  if (!msalInstance) return;
  const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  if (account) {
    try { await msalInstance.logoutPopup({ account }); } catch {}
  }
}

export function clearOutlookCache() {
  try {
    if (typeof localStorage !== 'undefined') {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('msal.') || k.includes('login.microsoftonline')) localStorage.removeItem(k);
      });
    }
    if (typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('msal.') || k.includes('login.microsoftonline')) sessionStorage.removeItem(k);
      });
    }
  } catch {}
  msalInstance = null;
  msalClientIdUsed = null;
  msalTenantIdUsed = null;
  msalInitPromise = null;
}
