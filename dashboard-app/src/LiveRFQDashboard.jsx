import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseEml } from "./emlParser.js";
import { callLLM, PROVIDERS, OPENROUTER_MODELS, SUPPLIER_PARSE_PROMPT, scoreSupplierResponse, DEFAULT_FX_TO_USD } from "./llmClient.js";
import { exportToExcel, exportToPDF } from "./exportUtils.js";
import {
  gmailSignIn, gmailListMessages, gmailFetchRaw, gmailSendMessage,
  outlookSignIn, acquireOutlookToken, outlookListMessages, outlookFetchMessage,
  outlookSendMessage, outlookSignOut, initOutlook, clearOutlookCache,
} from "./mailProviders.js";
import { PARSE_PROMPT } from "./prompts.js";
import { buildSupplierEmail, buildFollowUpEmail } from "./emailTemplates.js";
import { STATUS } from "./constants.js";
import {
  RefreshIcon, ZapIcon, CheckIcon, ClockIcon, AlertIcon, SendIcon, XIcon,
  SearchIcon, BoxIcon, PlayIcon, PauseIcon, InboxIcon, SunIcon, MoonIcon,
  SettingsIcon, DownloadIcon, UsersIcon,
} from "./icons.jsx";

// List of example .eml files served from public/example-mails/
// This directory is gitignored — drop your own sample RFQ emails here for local testing
// and list their filenames below (see docs/setup.md).
const EXAMPLE_EMAILS = [
  // "rfq-sample-1.eml",
];

// Supplier response example files served from public/supplier-mails/
// This directory is gitignored — drop your own sample supplier reply emails here for local
// testing and list their filenames below (see docs/setup.md).
const SUPPLIER_MAIL_FILES = [
  // "supplier-reply-sample-1.eml",
];

// ─── PDF text extraction (pdfjs-dist, lazy-loaded) ─────────────────────────
async function extractPdfText(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const data = await file.arrayBuffer();
  const pdf  = await getDocument({ data: new Uint8Array(data) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(s => s.str).join(' '));
  }
  return pages.join('\n').trim();
}

// ─── Main Dashboard ─────────────────────────────────────────────────────
export default function LiveRFQDashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [pollInterval, setPollInterval] = useState(60);
  const [searchQuery, setSearchQuery] = useState("subject:(RFQ OR הצעת מחיר OR rfq) newer_than:7d");
  const [rfqs, setRfqs] = useState(() => {
    try {
      const saved = localStorage.getItem('rfq-data');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [logs, setLogs] = useState([]);
  const [selectedRfq, setSelectedRfq] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [filterText, setFilterText] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState({ processed: 0, errors: 0, lastCheck: null });
  // Provider configuration (persisted)
  const lsGet = (k, d = '') => (typeof localStorage !== 'undefined' ? (localStorage.getItem(k) ?? d) : d);
  const [provider, setProvider] = useState(() => lsGet('rfq-provider', 'anthropic'));
  const [anthropicApiKey, setAnthropicApiKey] = useState(() => lsGet('rfq-anthropic-key'));
  const [anthropicModel, setAnthropicModel] = useState(() => lsGet('rfq-anthropic-model', 'claude-sonnet-4-6'));
  const [openaiApiKey, setOpenaiApiKey] = useState(() => lsGet('rfq-openai-key'));
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(() => lsGet('rfq-openai-base', 'https://api.openai.com/v1'));
  const [openaiModel, setOpenaiModel] = useState(() => lsGet('rfq-openai-model', 'gpt-4o-mini'));
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(() => lsGet('rfq-ollama-base', 'http://localhost:11434'));
  const [ollamaModel, setOllamaModel] = useState(() => lsGet('rfq-ollama-model', 'llama3.1'));
  const [openrouterApiKey, setOpenrouterApiKey] = useState(() => lsGet('rfq-openrouter-key'));
  const [openrouterModel, setOpenrouterModel] = useState(() => lsGet('rfq-openrouter-model', 'anthropic/claude-3.5-sonnet'));
  const [manualMode, setManualMode] = useState(() => lsGet('rfq-manual-mode', 'false') === 'true');
  const [selectedExample, setSelectedExample] = useState('');
  const [collapsedClients, setCollapsedClients] = useState(new Set());
  const [testEmailImage, setTestEmailImage]     = useState(null); // { data, mimeType, dataUrl }
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [testUploadLoading, setTestUploadLoading] = useState(false);
  const [uploadQueue, setUploadQueue]           = useState([]); // [{ id, name, status, error }]
  const fileInputRef = useRef(null);

  // Real mailbox (Gmail / Outlook)
  const [googleClientId, setGoogleClientId] = useState(() => lsGet('rfq-google-client-id'));
  const [msClientId, setMsClientId] = useState(() => lsGet('rfq-ms-client-id'));
  const [msTenantId, setMsTenantId] = useState(() => lsGet('rfq-ms-tenant-id'));
  const [mailProvider, setMailProvider] = useState(() => lsGet('rfq-mail-provider', 'gmail'));
  const [mailToken, setMailToken] = useState(null);
  const [mailSearch, setMailSearch] = useState('newer_than:30d (RFQ OR הצעת מחיר)');
  const [mailMessages, setMailMessages] = useState([]);
  const [mailLoading, setMailLoading] = useState(false);

  // ── Export / selection ──────────────────────────────────────────────────
  const [checkedRfqIds, setCheckedRfqIds] = useState({});

  // ── Pipeline back-step modal ────────────────────────────────────────────
  const [backModal, setBackModal] = useState(null); // { rfqId } | null
  const [backComment, setBackComment] = useState('');

  // ── Log verbosity ───────────────────────────────────────────────────────
  const [verboseLog, setVerboseLog] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState(null);

  // ── Supplier list (persisted) ───────────────────────────────────────────
  const [supplierList, setSupplierList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rfq-supplier-list') || '[]'); } catch { return []; }
  });
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [sendingSuppliers, setSendingSuppliers] = useState(false);

  // ── FX rates for supplier price scoring (persisted) ─────────────────────
  const [fxRates, setFxRates] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rfq-fx-rates') || 'null');
      return saved ? { ...DEFAULT_FX_TO_USD, ...saved } : { ...DEFAULT_FX_TO_USD };
    } catch { return { ...DEFAULT_FX_TO_USD }; }
  });
  useEffect(() => {
    try { localStorage.setItem('rfq-fx-rates', JSON.stringify(fxRates)); } catch {}
  }, [fxRates]);

  // ── Dashboard filters ───────────────────────────────────────────────────
  const [showObsoleteOnly, setShowObsoleteOnly] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  // ── Test tab — Section B (outreach preview) ─────────────────────────────
  const [testOutreachRfqId, setTestOutreachRfqId] = useState('');

  // ── Test tab — Section C (supplier response parse) ──────────────────────
  const [testSupplierFile, setTestSupplierFile] = useState('');
  const [testSupplierText, setTestSupplierText] = useState('');
  const [testSupplierLinkRfqId, setTestSupplierLinkRfqId] = useState('');
  const [testSupplierResult, setTestSupplierResult] = useState(null);
  const [testSupplierProcessing, setTestSupplierProcessing] = useState(false);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('rfq-provider', provider);
    localStorage.setItem('rfq-anthropic-key', anthropicApiKey || '');
    localStorage.setItem('rfq-anthropic-model', anthropicModel || '');
    localStorage.setItem('rfq-openai-key', openaiApiKey || '');
    localStorage.setItem('rfq-openai-base', openaiBaseUrl || '');
    localStorage.setItem('rfq-openai-model', openaiModel || '');
    localStorage.setItem('rfq-ollama-base', ollamaBaseUrl || '');
    localStorage.setItem('rfq-ollama-model', ollamaModel || '');
    localStorage.setItem('rfq-openrouter-key', openrouterApiKey || '');
    localStorage.setItem('rfq-openrouter-model', openrouterModel || '');
    localStorage.setItem('rfq-manual-mode', manualMode ? 'true' : 'false');
    localStorage.setItem('rfq-google-client-id', googleClientId || '');
    localStorage.setItem('rfq-ms-client-id', msClientId || '');
    localStorage.setItem('rfq-ms-tenant-id', msTenantId || '');
    localStorage.setItem('rfq-mail-provider', mailProvider || 'gmail');
  }, [provider, anthropicApiKey, anthropicModel, openaiApiKey, openaiBaseUrl, openaiModel, ollamaBaseUrl, ollamaModel, openrouterApiKey, openrouterModel, manualMode, googleClientId, msClientId, msTenantId, mailProvider]);

  // Persist RFQ list to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem('rfq-data', JSON.stringify(rfqs)); } catch {}
  }, [rfqs]);

  useEffect(() => {
    try { localStorage.setItem('rfq-supplier-list', JSON.stringify(supplierList)); } catch {}
  }, [supplierList]);

  // Warm up MSAL early so popup opens synchronously from the click handler
  useEffect(() => {
    if (msClientId) {
      initOutlook(msClientId, msTenantId).catch(err => console.error("[msal init]", err));
    }
  }, [msClientId, msTenantId]);

  const llmConfig = useMemo(() => ({
    provider,
    anthropicApiKey, anthropicModel,
    openaiApiKey, openaiBaseUrl, openaiModel,
    ollamaBaseUrl, ollamaModel,
    openrouterApiKey, openrouterModel,
  }), [provider, anthropicApiKey, anthropicModel, openaiApiKey, openaiBaseUrl, openaiModel, ollamaBaseUrl, ollamaModel, openrouterApiKey, openrouterModel]);

  const providerReady = (
    (provider === 'anthropic' && !!anthropicApiKey) ||
    (provider === 'openai' && !!openaiBaseUrl) ||
    (provider === 'ollama' && !!ollamaBaseUrl) ||
    (provider === 'openrouter' && !!openrouterApiKey)
  );
  const [theme, setTheme] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('rfq-theme')) || 'dark');
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.background = theme === 'dark' ? '#05070A' : '#F4F6FA';
      document.body.style.color = theme === 'dark' ? '#D4DAE8' : '#1A2030';
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem('rfq-theme', theme);
  }, [theme]);
  const themeVars = theme === 'dark' ? {
    "--bg": "#05070A",
    "--surface": "#0B0E14",
    "--surface2": "#111520",
    "--surface3": "#181D2A",
    "--border": "#1C2233",
    "--border2": "#252D42",
    "--text": "#D4DAE8",
    "--text2": "#8892A8",
    "--text3": "#505A70",
  } : {
    "--bg": "#F4F6FA",
    "--surface": "#FFFFFF",
    "--surface2": "#F1F4F9",
    "--surface3": "#E6EAF2",
    "--border": "#D9DEE8",
    "--border2": "#C2C9D6",
    "--text": "#1A2030",
    "--text2": "#4A5468",
    "--text3": "#7A8497",
  };
  const timerRef = useRef(null);
  const isPollActiveRef = useRef(false);
  // Persisted across page reloads — prevents re-processing emails after refresh
  const processedIdsRef = useRef(new Set(
    (() => { try { return JSON.parse(localStorage.getItem('rfq-processed-ids') || '[]'); } catch { return []; } })()
  ));
  const markProcessed = useCallback((id) => {
    processedIdsRef.current.add(id);
    try {
      // Cap at 1000 most-recent IDs to avoid unbounded localStorage growth
      const arr = [...processedIdsRef.current].slice(-1000);
      localStorage.setItem('rfq-processed-ids', JSON.stringify(arr));
    } catch {}
  }, []);

  const addLog = useCallback((message, type = "info", detail = null) => {
    setLogs(prev => [{
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString("en-GB"),
      message,
      type,
      detail, // raw error object / API response — shown in verbose mode
    }, ...prev].slice(0, 200));
  }, []);

  // ─── Process a single email text with Claude ───────────────────────
  const processEmail = useCallback(async (emailText, emailId, imageData = null, imageMimeType = null) => {
    if (processedIdsRef.current.has(emailId)) return null;
    markProcessed(emailId);

    // Extract sender address and subject for follow-up emails
    const fromMatch = emailText.match(
      /^From:\s*(?:[^<\n]*<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/im
    );
    const fromEmail = fromMatch ? fromMatch[1].trim() : null;
    const subjectMatch = emailText.match(/^Subject:\s*(.+)$/im);
    const originalSubject = subjectMatch ? subjectMatch[1].trim() : '';

    addLog(`🔄 Processing email: ${emailId?.substring(0, 30)}...`, "info");
    setIsProcessing(true);

    try {
      const result = await callLLM(
        imageData && !emailText.trim()
          ? 'Please parse this RFQ from the image. Extract all part numbers, quantities, delivery dates, customer name, and other relevant fields.'
          : `Parse this RFQ email:\n\n${emailText}`,
        PARSE_PROMPT,
        llmConfig,
        imageData,
        imageMimeType
      );

      if (!result || typeof result === 'object') {
        const err = result && result.error;
        const msg = err === 'missing_key'
          ? 'Enter an API Key in Settings before processing'
          : err === 'missing_base_url'
            ? 'Missing Base URL for OpenAI-compatible provider'
            : `Email processing error: ${err || 'unknown'}`;
        addLog(`❌ ${msg}`, "error", result);
        setStats(p => ({ ...p, errors: p.errors + 1 }));
        setIsProcessing(false);
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (parseErr) {
        addLog(`⚠️ Invalid AI response — JSON parse failed`, "warning", { raw: result, error: parseErr?.message });
        setIsProcessing(false);
        return null;
      }

      const newRfqs = (parsed.parts || []).map((part, i) => ({
        id: `RFQ-${Date.now()}-${i}`,
        emailId,
        // Core parsed fields
        customerName:        part.customerName || "—",
        partNumber:          part.partNumber   || "N/A",
        quantity:            part.quantity     || 0,
        deliveryDate:        part.deliveryDate || null,
        acceptsAlternatives: part.acceptsAlternatives || "Not specified",
        targetPrice:         part.targetPrice  ?? null,
        specialRequirements: part.specialRequirements || null,
        isObsolete:          part.isObsolete === true,
        // Email-level fields
        sender:          parsed.sender   || "Unknown",
        priority:        parsed.priority || "medium",
        summary:         parsed.summary  || "",
        fromEmail,
        originalSubject,
        // Pipeline fields
        status:          "parsed",
        createdAt:       new Date().toISOString(),
        statusHistory:   [],   // { from, to, comment, ts }[]
        humanLoop:       false,
        supplierResponses: [], // attached supplier quotes
      }));

      setRfqs(prev => [...newRfqs, ...prev]);
      setStats(p => ({ ...p, processed: p.processed + newRfqs.length }));

      const obsCount = newRfqs.filter(r => r.isObsolete).length;
      addLog(
        `✅ Extracted ${newRfqs.length} part(s)${obsCount ? ` · ${obsCount} OBS` : ''} — ${parsed.summary || ""}`,
        "success"
      );

      // ── Auto follow-up when delivery date is missing ──────────────
      // Only fires for real inbox emails (not test/paste), and only when connected
      const isRealInbox = emailId?.startsWith('gmail-') || emailId?.startsWith('outlook-');
      const missingDate  = newRfqs.filter(r => !r.deliveryDate);
      if (isRealInbox && mailToken && fromEmail && missingDate.length > 0) {
        try {
          const followSubject = originalSubject
            ? `Re: ${originalSubject} — Delivery date required`
            : 'Delivery date required for your RFQ';
          const followBody = buildFollowUpEmail(missingDate);
          if (mailProvider === 'gmail') {
            await gmailSendMessage(mailToken, fromEmail, followSubject, followBody);
          } else {
            const freshToken = await acquireOutlookToken(msClientId, msTenantId).catch(() => mailToken);
            await outlookSendMessage(freshToken, fromEmail, followSubject, followBody);
          }
          addLog(`📤 Follow-up sent → ${fromEmail} (${missingDate.length} part(s) missing delivery date)`, "info");
        } catch (sendErr) {
          addLog(`⚠️ Follow-up send failed: ${sendErr.message}`, "warning", sendErr);
        }
      }

      setIsProcessing(false);
      return newRfqs;
    } catch (e) {
      addLog(`❌ Error: ${e.message}`, "error", e);
      setStats(p => ({ ...p, errors: p.errors + 1 }));
      setIsProcessing(false);
      return null;
    }
  }, [addLog, llmConfig, markProcessed, mailToken, mailProvider, msClientId, msTenantId]);

  // ─── Real mailbox handlers (Gmail / Outlook) ──────────────────────
  const connectMailbox = useCallback(async () => {
    try {
      setMailLoading(true);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      addLog(`🌐 Current origin: ${origin} (make sure it is registered in your OAuth client)`, "info");
      if (mailProvider === 'gmail') {
        if (!googleClientId) { addLog("❌ Missing Google Client ID in Settings", "error"); setMailLoading(false); return; }
        const token = await gmailSignIn(googleClientId);
        setMailToken(token);
        addLog("✅ Connected to Gmail", "success");
      } else {
        if (!msClientId) { addLog("❌ Missing Microsoft Client ID in Settings", "error"); setMailLoading(false); return; }
        const token = await outlookSignIn(msClientId, msTenantId);
        setMailToken(token);
        addLog("✅ Connected to Outlook", "success");
      }
    } catch (e) {
      const msg = e?.errorCode || e?.message || String(e);
      let hint = '';
      if (/popup_window_error|popup_window_blocked|blocked/i.test(msg)) hint = ' — Browser blocked the popup. Allow popups for this site in the address bar.';
      else if (/user_cancelled/i.test(msg)) hint = ' — User closed the sign-in window.';
      else if (/AADSTS50194/i.test(msg)) hint = ' — App is single-tenant. Fill in Tenant ID or switch to multi-tenant.';
      else if (/invalid_client|unauthorized_client/i.test(msg) && mailProvider === 'gmail') hint = ` — Google OAuth: add ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080'} to Authorized JavaScript Origins in Google Cloud Console → APIs & Services → Credentials.`;
      else if (/AADSTS|invalid_client|unauthorized_client/i.test(msg)) hint = ' — App configuration error in Entra (Client ID / Redirect URI / Scopes).';
      addLog(`❌ Connection failed: ${msg}${hint}`, "error");
      console.error("[mail connect]", e);
    } finally {
      setMailLoading(false);
    }
  }, [mailProvider, googleClientId, msClientId, msTenantId, addLog]);

  const resetOutlookCache = useCallback(() => {
    clearOutlookCache();
    setMailToken(null);
    setMailMessages([]);
    if (msClientId) initOutlook(msClientId, msTenantId).catch(err => console.error("[msal re-init]", err));
    addLog("🧹 MSAL cache cleared — try connecting again", "info");
  }, [msClientId, msTenantId, addLog]);

  const refreshMailbox = useCallback(async () => {
    if (!mailToken) { addLog("⚠️ Connect your mailbox first", "warning"); return; }
    setMailLoading(true);
    try {
      const list = mailProvider === 'gmail'
        ? await gmailListMessages(mailToken, mailSearch, 25)
        : await outlookListMessages(mailToken, mailSearch, 25);
      setMailMessages(list);
      addLog(`📬 Loaded ${list.length} messages from ${mailProvider}`, "info");
    } catch (e) {
      addLog(`❌ Failed to load message list: ${e.message}`, "error");
    } finally {
      setMailLoading(false);
    }
  }, [mailProvider, mailToken, mailSearch, addLog]);

  const processMailMessage = useCallback(async (msg) => {
    if (!providerReady) { addLog("⚠️ Configure an LLM provider in Settings first", "warning"); return; }
    try {
      addLog(`🔍 Loading email: ${msg.subject}`, "info");
      let text;
      if (mailProvider === 'gmail') {
        const raw = await gmailFetchRaw(mailToken, msg.id);
        const parsed = parseEml(raw);
        text = parsed.formatted;
      } else {
        // Refresh token silently if needed
        const token = await acquireOutlookToken(msClientId, msTenantId).catch(() => mailToken);
        setMailToken(token);
        const parsed = await outlookFetchMessage(token, msg.id);
        text = parsed.formatted;
      }
      await processEmail(text, `${mailProvider}-${msg.id}`);
    } catch (e) {
      addLog(`❌ Processing failed: ${e.message}`, "error");
    }
  }, [mailProvider, mailToken, msClientId, msTenantId, processEmail, providerReady, addLog]);

  const disconnectMailbox = useCallback(async () => {
    try {
      if (mailProvider === 'outlook' && msClientId) {
        await outlookSignOut(msClientId);
      }
    } catch {}
    setMailToken(null);
    setMailMessages([]);
    addLog(`🔌 Disconnected from ${mailProvider}`, "info");
  }, [mailProvider, msClientId, addLog]);

  // ─── Load example .eml into the test textarea ─────────────────────
  const loadExample = useCallback(async (filename) => {
    if (!filename) return;
    try {
      addLog(`📥 Loading example: ${filename}`, "info");
      const res = await fetch(`/example-mails/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const parsed = parseEml(raw);
      setTestEmail(parsed.formatted);
      setActiveTab('test');
      addLog(`✅ Loaded: ${parsed.subject || filename}`, "success");
    } catch (e) {
      addLog(`❌ Load failed: ${e.message}`, "error");
    }
  }, [addLog]);

  // ─── Poll real mailbox (Gmail or Outlook) ─────────────────────────
  const pollGmail = useCallback(async () => {
    if (!mailToken) {
      addLog("⚠️ Connect your mailbox (Inbox) before starting the system", "warning");
      return;
    }
    // Prevent concurrent poll runs — skip if previous poll still in progress
    if (isPollActiveRef.current) {
      addLog("⏭ Previous poll still active — skipping", "info");
      return;
    }
    isPollActiveRef.current = true;
    addLog(`📬 Checking ${mailProvider}...`, "info");
    setStats(p => ({ ...p, lastCheck: new Date().toLocaleTimeString("en-GB") }));
    try {
      const list = mailProvider === 'gmail'
        ? await gmailListMessages(mailToken, searchQuery, 10)
        : await outlookListMessages(mailToken, searchQuery, 10);
      const fresh = list.filter(m => !processedIdsRef.current.has(`${mailProvider}-${m.id}`));
      if (fresh.length === 0) { addLog("📭 No new emails", "info"); return; }
      addLog(`🆕 Found ${fresh.length} new email(s)`, "info");
      // Eagerly mark all fresh IDs before any async processing starts —
      // prevents a second concurrent poll from picking up the same messages
      fresh.forEach(m => markProcessed(`${mailProvider}-${m.id}`));
      for (const msg of fresh) {
        await processMailMessage(msg);
      }
    } catch (e) {
      addLog(`❌ Mailbox error: ${e.message}`, "error");
    } finally {
      isPollActiveRef.current = false;
    }
  }, [mailToken, mailProvider, searchQuery, addLog, markProcessed, processMailMessage]);

  // ─── Auto-poll loop ────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning && mailToken && !manualMode) {
      pollGmail();
      timerRef.current = setInterval(pollGmail, pollInterval * 1000);
      return () => clearInterval(timerRef.current);
    } else {
      clearInterval(timerRef.current);
    }
  }, [isRunning, mailToken, manualMode, pollInterval, pollGmail]);

  // ─── File upload handler (supports multiple .eml via queue) ──────────
  const handleFileUpload = useCallback(async (files) => {
    const fileList = Array.from(files instanceof FileList ? files : [files]);
    if (!fileList.length) return;
    const entries = fileList.map(f => ({ id: `${f.name}-${Date.now()}-${Math.random()}`, name: f.name, status: 'pending', error: null }));
    setUploadQueue(entries);
    setTestEmailImage(null);
    setUploadedFileName('');

    for (let i = 0; i < fileList.length; i++) {
      const file    = fileList[i];
      const entryId = entries[i].id;
      setUploadQueue(q => q.map(e => e.id === entryId ? { ...e, status: 'processing' } : e));
      setTestUploadLoading(true);
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'eml') {
          const text   = await file.text();
          const parsed = parseEml(text);
          setTestEmail(parsed.text || text);
          setUploadedFileName(file.name);
        } else if (ext === 'pdf') {
          const text = await extractPdfText(file);
          setTestEmail(text);
          setUploadedFileName(file.name);
        } else if (file.type.startsWith('image/')) {
          await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => {
              const dataUrl = e.target.result;
              const base64  = dataUrl.split(',')[1];
              setTestEmailImage({ data: base64, mimeType: file.type, dataUrl });
              setTestEmail('');
              setUploadedFileName(file.name);
              resolve();
            };
            reader.readAsDataURL(file);
          });
        } else {
          setTestEmail(await file.text());
          setUploadedFileName(file.name);
        }
        setUploadQueue(q => q.map(e => e.id === entryId ? { ...e, status: 'done' } : e));
      } catch (err) {
        addLog(`❌ File read error (${file.name}): ${err.message}`, 'error');
        setUploadQueue(q => q.map(e => e.id === entryId ? { ...e, status: 'error', error: err.message } : e));
      } finally {
        setTestUploadLoading(false);
      }
    }
  }, [addLog]);

  // ─── Manual test processing ────────────────────────────────────────
  const handleTestProcess = useCallback(async () => {
    if (!testEmail.trim() && !testEmailImage) return;
    const prompt = testEmail.trim() || 'Please parse the RFQ from this image.';
    await processEmail(prompt, `test-${Date.now()}`, testEmailImage?.data, testEmailImage?.mimeType);
    setTestEmail('');
    setTestEmailImage(null);
    setUploadedFileName('');
  }, [testEmail, testEmailImage, processEmail]);

  // ─── Advance RFQ status ────────────────────────────────────────────
  const advanceStatus = useCallback((rfqId) => {
    const flow = ["new", "processing", "parsed", "ready", "distributed", "awaiting", "completed"];
    setRfqs(prev => prev.map(r => {
      if (r.id !== rfqId) return r;
      const idx = flow.indexOf(r.status);
      if (idx < flow.length - 1) return { ...r, status: flow[idx + 1] };
      return r;
    }));
  }, []);

  // ─── Revert RFQ status one step back (requires comment) ───────────
  const revertStatus = useCallback((rfqId, comment) => {
    const flow = ["new", "processing", "parsed", "ready", "distributed", "awaiting", "completed"];
    setRfqs(prev => prev.map(r => {
      if (r.id !== rfqId) return r;
      const idx = flow.indexOf(r.status);
      if (idx <= 0) return r; // already at start
      const prevStatus = flow[idx - 1];
      const histEntry = {
        from: r.status,
        to: prevStatus,
        comment,
        ts: new Date().toLocaleTimeString("en-GB"),
      };
      return {
        ...r,
        status: prevStatus,
        statusHistory: [...(r.statusHistory || []), histEntry],
      };
    }));
    addLog(`◂ Step back — ${rfqId.slice(-8)}: "${comment}"`, "info");
    setBackModal(null);
    setBackComment('');
  }, [addLog]);

  // ─── Toggle human-in-loop flag ─────────────────────────────────────
  const toggleHumanLoop = useCallback((rfqId) => {
    setRfqs(prev => prev.map(r =>
      r.id === rfqId ? { ...r, humanLoop: !r.humanLoop } : r
    ));
  }, []);

  // ─── Send RFQ to all suppliers in the list ─────────────────────────
  const sendToSuppliers = useCallback(async (rfq) => {
    if (!mailToken) {
      addLog("⚠️ Connect your mailbox before sending to suppliers", "warning");
      return;
    }
    if (!supplierList.length) {
      addLog("⚠️ Add suppliers in Settings → Supplier List", "warning");
      return;
    }
    // Block if human-loop flag is set
    if (rfq.humanLoop) {
      addLog(`🔍 RFQ ${rfq.partNumber} is flagged for manual review — remove the flag before sending`, "warning");
      return;
    }
    setSendingSuppliers(true);
    const subject = `RFQ — ${rfq.partNumber}`;
    const body = buildSupplierEmail(rfq);
    let sent = 0;
    for (const sup of supplierList) {
      try {
        if (mailProvider === 'gmail') {
          await gmailSendMessage(mailToken, sup.email, subject, body);
        } else {
          const freshToken = await acquireOutlookToken(msClientId, msTenantId).catch(() => mailToken);
          await outlookSendMessage(freshToken, sup.email, subject, body);
        }
        addLog(`📤 Sent to ${sup.name} <${sup.email}>`, "success");
        sent++;
      } catch (e) {
        addLog(`❌ Send to ${sup.email} failed: ${e.message}`, "error", e);
      }
    }
    if (sent > 0) {
      advanceStatus(rfq.id); // → distributed
      addLog(`✅ RFQ ${rfq.partNumber} distributed to ${sent}/${supplierList.length} supplier(s)`, "success");
    }
    setSendingSuppliers(false);
  }, [mailToken, mailProvider, msClientId, msTenantId, supplierList, addLog, advanceStatus]);

  // ─── Supplier list helpers ─────────────────────────────────────────
  const addSupplier = useCallback(() => {
    const name  = newSupplierName.trim();
    const email = newSupplierEmail.trim().toLowerCase();
    if (!name || !email || !email.includes('@')) return;
    if (supplierList.some(s => s.email === email)) {
      addLog(`⚠️ ${email} already exists in the supplier list`, "warning");
      return;
    }
    setSupplierList(prev => [...prev, { name, email }]);
    setNewSupplierName('');
    setNewSupplierEmail('');
    addLog(`➕ Supplier added: ${name} <${email}>`, "success");
  }, [newSupplierName, newSupplierEmail, supplierList, addLog]);

  const removeSupplier = useCallback((idx) => {
    setSupplierList(prev => {
      const removed = prev[idx];
      addLog(`🗑 Supplier removed: ${removed?.name}`, "info");
      return prev.filter((_, i) => i !== idx);
    });
  }, [addLog]);

  // ─── Load a supplier-response .eml from public/supplier-mails/ ────
  const loadSupplierMail = useCallback(async (filename) => {
    if (!filename) return;
    try {
      addLog(`📥 Loading supplier response: ${filename}`, "info");
      const res = await fetch(`/supplier-mails/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const parsed = parseEml(raw);
      setTestSupplierText(parsed.formatted);
      addLog(`✅ Loaded: ${parsed.subject || filename}`, "success");
    } catch (e) {
      addLog(`❌ Failed to load supplier mail: ${e.message}`, "error", e);
    }
  }, [addLog]);

  // ─── Parse + score a supplier response ────────────────────────────
  const processSupplierResponse = useCallback(async () => {
    if (!testSupplierText.trim()) return;
    setTestSupplierProcessing(true);
    setTestSupplierResult(null);

    try {
      const result = await callLLM(
        `Parse this supplier response email:\n\n${testSupplierText}`,
        SUPPLIER_PARSE_PROMPT,
        llmConfig
      );

      if (!result || typeof result === 'object') {
        addLog(`❌ Supplier response processing failed: ${result?.error || 'unknown'}`, "error", result);
        setTestSupplierProcessing(false);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (parseErr) {
        addLog(`⚠️ Invalid JSON from supplier response`, "warning", { raw: result, error: parseErr?.message });
        setTestSupplierProcessing(false);
        return;
      }

      // Score against linked RFQ (if selected)
      const linkedRfq = rfqs.find(r => r.id === testSupplierLinkRfqId) || null;
      const score = scoreSupplierResponse(parsed, linkedRfq, fxRates);

      const entry = {
        ...parsed,
        score,
        rfqId:      testSupplierLinkRfqId || null,
        receivedAt: new Date().toLocaleTimeString("en-GB"),
      };

      setTestSupplierResult(entry);

      // Attach to the linked RFQ
      if (testSupplierLinkRfqId) {
        setRfqs(prev => prev.map(r => {
          if (r.id !== testSupplierLinkRfqId) return r;
          return {
            ...r,
            supplierResponses: [...(r.supplierResponses || []), entry],
            // If already distributed, mark as awaiting replies
            status: r.status === 'distributed' ? 'awaiting' : r.status,
          };
        }));
        addLog(`📊 Supplier response linked to ${linkedRfq?.partNumber || testSupplierLinkRfqId} — score: ${score}`, "success");
      } else {
        addLog(`📊 Supplier response processed — score: ${score}`, "success");
      }
    } catch (e) {
      addLog(`❌ Error processing supplier response: ${e.message}`, "error", e);
    }

    setTestSupplierProcessing(false);
  }, [testSupplierText, testSupplierLinkRfqId, rfqs, llmConfig, addLog, fxRates]);

  // ─── Filtered RFQs ────────────────────────────────────────────────
  const filteredRfqs = useMemo(() => {
    let result = rfqs;
    if (showObsoleteOnly) result = result.filter(r => r.isObsolete);
    if (filterStatus) result = result.filter(r => r.status === filterStatus);
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(r =>
        r.partNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        (r.specialRequirements || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [rfqs, filterText, showObsoleteOnly, filterStatus]);

  const groupedByClient = useMemo(() => {
    const map = new Map();
    filteredRfqs.forEach(rfq => {
      const key = rfq.customerName || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rfq);
    });
    return [...map.entries()].sort(([, a], [, b]) => {
      const la = Math.max(...a.map(r => new Date(r.createdAt).getTime() || 0));
      const lb = Math.max(...b.map(r => new Date(r.createdAt).getTime() || 0));
      return lb - la;
    });
  }, [filteredRfqs]);

  const toggleClient = useCallback((name) => {
    setCollapsedClients(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const statusCounts = useMemo(() => {
    const c = {};
    Object.keys(STATUS).forEach(k => c[k] = 0);
    rfqs.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
    return c;
  }, [rfqs]);

  // ─── RENDER ────────────────────────────────────────────────────────
  return (
    <div style={{
      ...themeVars,
      "--accent": "#38BDF8",
      "--green": "#34D399",
      "--red": "#F87171",
      "--amber": "#FBBF24",
      "--purple": "#A78BFA",
      "--pink": "#F472B6",

      background: "var(--bg)",
      color: "var(--text)",
      minHeight: "100vh",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      direction: "ltr",
      fontSize: 13,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #252D42; border-radius: 3px; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        textarea, input { font-family: inherit; }
        button { font-family: inherit; }
      `}</style>

      {/* ─── Header ──────────────────────────────────────────────── */}
      <header style={{
        padding: "16px 28px",
        borderBottom: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "var(--surface)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #38BDF8, #A78BFA)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: "#fff",
          }}>R</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
              RFQ <span style={{ color: "var(--accent)" }}>DASHBOARD</span>
            </div>
            <div style={{ fontSize: 10, color: "var(--text3)", letterSpacing: "0.05em" }}>
              AUTOMATED PROCUREMENT PIPELINE
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Status indicator */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8,
            background: isRunning ? "#34D39910" : "var(--surface2)",
            border: `1px solid ${isRunning ? "#34D39930" : "var(--border)"}`,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: isRunning ? "var(--green)" : "var(--text3)",
              animation: isRunning ? "blink 2s infinite" : "none",
            }} />
            <span style={{ fontSize: 11, color: isRunning ? "var(--green)" : "var(--text3)" }}>
              {isRunning ? "LIVE" : "STOPPED"}
            </span>
          </div>

          {stats.lastCheck && (
            <span style={{ fontSize: 10, color: "var(--text3)" }}>
              Last check: {stats.lastCheck}
            </span>
          )}

          {/* Provider badge */}
          <button
            onClick={() => setActiveTab('config')}
            title="Change LLM provider in Settings"
            style={{
              padding: "6px 10px", borderRadius: 8,
              background: providerReady ? "var(--surface2)" : "#F8717120",
              border: `1px solid ${providerReady ? "var(--border)" : "#F8717160"}`,
              color: providerReady ? "var(--text2)" : "var(--red)",
              fontSize: 10, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            🤖 {provider}{providerReady ? "" : " ⚠"}
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 8,
              background: "var(--surface2)", border: "1px solid var(--border)",
              color: "var(--text2)", cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
        </div>
      </header>

      {/* ─── Tab Nav ─────────────────────────────────────────────── */}
      <nav style={{
        display: "flex", gap: 0, borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "0 28px",
      }}>
        {[
          { id: "dashboard", label: "Dashboard", icon: <BoxIcon size={14} /> },
          { id: "inbox", label: "Inbox", icon: <InboxIcon size={14} /> },
          { id: "config", label: "Configuration", icon: <SettingsIcon size={14} /> },
          { id: "test", label: "Test / Manual", icon: <ZapIcon size={14} /> },
          { id: "logs", label: "Activity Log", icon: <ClockIcon size={14} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "12px 20px",
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === tab.id ? "var(--accent)" : "var(--text3)",
              borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 400,
              transition: "all 0.2s",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: "24px 28px", maxWidth: 1300, margin: "0 auto" }}>

        {/* ━━━ DASHBOARD TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "dashboard" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>

            {/* KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "Total RFQs",  value: rfqs.length,               color: "var(--accent)", icon: <InboxIcon   size={16} color="var(--accent)" /> },
                { label: "Processed",   value: stats.processed,            color: "var(--green)",  icon: <CheckIcon   size={16} color="var(--green)" /> },
                { label: "Awaiting",    value: statusCounts.awaiting || 0, color: "var(--amber)",  icon: <ClockIcon   size={16} color="var(--amber)" /> },
                { label: "Errors",      value: stats.errors,               color: "var(--red)",    icon: <AlertIcon   size={16} color="var(--red)" /> },
                { label: "Completed",   value: statusCounts.completed || 0,color: "var(--green)",  icon: <CheckIcon   size={16} color="var(--green)" /> },
                { label: "Obsolete",    value: rfqs.filter(r=>r.isObsolete).length, color: "#FB923C", icon: <AlertIcon size={16} color="#FB923C" /> },
              ].map((kpi, i) => (
                <div key={i} style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 12, padding: "16px 18px",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: `${kpi.color}10`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{kpi.icon}</div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>{kpi.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pipeline status bar */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "18px 20px", marginBottom: 24,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "var(--text2)" }}>
                PIPELINE STATUS
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {Object.entries(STATUS).map(([key, st]) => (
                  <div key={key} style={{
                    flex: 1, padding: "10px 8px", borderRadius: 8,
                    background: statusCounts[key] > 0 ? st.bg : "var(--surface2)",
                    border: `1px solid ${statusCounts[key] > 0 ? st.color + "20" : "var(--border)"}`,
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: statusCounts[key] > 0 ? st.color : "var(--text3)" }}>
                      {statusCounts[key] || 0}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text3)", marginTop: 4 }}>{st.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RFQ Table */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, overflow: "hidden",
            }}>
              <div style={{
                padding: "12px 18px", borderBottom: "1px solid var(--border)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                flexWrap: "wrap", gap: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Select-all checkbox */}
                  <input
                    type="checkbox"
                    title="Select / Deselect all"
                    checked={filteredRfqs.length > 0 && filteredRfqs.every(r => checkedRfqIds[r.id])}
                    onChange={e => {
                      if (e.target.checked) {
                        const all = {};
                        filteredRfqs.forEach(r => { all[r.id] = true; });
                        setCheckedRfqIds(all);
                      } else {
                        setCheckedRfqIds({});
                      }
                    }}
                    style={{ cursor: "pointer", accentColor: "var(--accent)" }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    PROCESSED RFQs ({filteredRfqs.length}{filteredRfqs.length !== rfqs.length ? `/${rfqs.length}` : ''})
                  </span>
                  {/* Clear all RFQs */}
                  {rfqs.length > 0 && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete all ${rfqs.length} RFQs from the list?`)) {
                          setRfqs([]);
                          setCheckedRfqIds({});
                          setSelectedRfq(null);
                          addLog("🗑 RFQ list cleared", "info");
                        }
                      }}
                      title="Delete all items from the list"
                      style={{
                        padding: "3px 8px", borderRadius: 6, fontSize: 9, fontWeight: 600,
                        cursor: "pointer", border: "1px solid var(--border)",
                        background: "var(--surface2)", color: "var(--text3)",
                        transition: "all 0.15s",
                      }}
                    >🗑 Clear all</button>
                  )}
                  {/* Obsolete filter chip */}
                  <button
                    onClick={() => setShowObsoleteOnly(v => !v)}
                    style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 9, fontWeight: 700,
                      cursor: "pointer", border: "1px solid #FB923C60",
                      background: showObsoleteOnly ? "#FB923C" : "#FB923C15",
                      color: showObsoleteOnly ? "#000" : "#FB923C",
                      transition: "all 0.15s",
                    }}
                  >OBS ONLY</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Status filter dropdown */}
                  <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    title="Filter by status"
                    style={{
                      padding: "5px 10px", borderRadius: 8,
                      background: filterStatus ? "var(--surface3)" : "var(--surface2)",
                      border: filterStatus ? "1px solid var(--accent)" : "1px solid var(--border)",
                      color: filterStatus ? "var(--accent)" : "var(--text3)",
                      fontSize: 10, outline: "none", cursor: "pointer",
                      fontWeight: filterStatus ? 700 : 400,
                    }}
                  >
                    <option value="">All statuses</option>
                    {Object.entries(STATUS).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  {/* Clear filters button — shown when any filter active */}
                  {(filterStatus || filterText || showObsoleteOnly) && (
                    <button
                      onClick={() => { setFilterStatus(''); setFilterText(''); setShowObsoleteOnly(false); }}
                      title="Clear all filters"
                      style={{
                        padding: "4px 9px", borderRadius: 8, fontSize: 10,
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text3)", cursor: "pointer",
                      }}
                    >✕</button>
                  )}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "var(--surface2)", borderRadius: 8,
                    padding: "5px 10px", border: "1px solid var(--border)",
                  }}>
                    <SearchIcon size={12} color="var(--text3)" />
                    <input
                      value={filterText}
                      onChange={e => setFilterText(e.target.value)}
                      placeholder="Search..."
                      style={{
                        background: "none", border: "none", outline: "none",
                        color: "var(--text)", fontSize: 11, width: 130,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Export bar — appears when items are selected */}
              {Object.keys(checkedRfqIds).length > 0 && (
                <div style={{
                  padding: "8px 18px", borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center", gap: 10,
                  background: "var(--surface2)",
                }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                    {Object.keys(checkedRfqIds).length} selected
                  </span>
                  <button
                    onClick={() => exportToExcel(rfqs.filter(r => checkedRfqIds[r.id]))}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700,
                      background: "#34D39920", color: "var(--green)",
                      border: "1px solid #34D39940", cursor: "pointer",
                    }}
                  ><DownloadIcon size={12} /> Excel</button>
                  <button
                    onClick={() => exportToPDF(rfqs.filter(r => checkedRfqIds[r.id]))}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700,
                      background: "#A78BFA20", color: "var(--purple)",
                      border: "1px solid #A78BFA40", cursor: "pointer",
                    }}
                  ><DownloadIcon size={12} /> PDF</button>
                  <button
                    onClick={() => setCheckedRfqIds({})}
                    style={{
                      padding: "5px 10px", borderRadius: 7, fontSize: 10,
                      background: "none", color: "var(--text3)",
                      border: "1px solid var(--border)", cursor: "pointer",
                    }}
                  >✕ Deselect</button>
                </div>
              )}

              {/* Table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "28px 20px 1fr 1.1fr 0.5fr 0.7fr 0.55fr 0.5fr 0.85fr 0.45fr 62px",
                gap: 6, padding: "8px 16px",
                borderBottom: "1px solid var(--border)",
                fontSize: 9, fontWeight: 600, color: "var(--text3)",
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}>
                <div></div>{/* checkbox */}
                <div></div>{/* priority dot */}
                <div>Customer</div>
                <div>Part Number</div>
                <div>Qty</div>
                <div>Delivery Date</div>
                <div>Alts?</div>
                <div>Target Price</div>
                <div>Special Req.</div>
                <div>Status</div>
                <div></div>{/* actions */}
              </div>

              {/* Table body */}
              <div style={{ overflowY: "auto" }}>
                {filteredRfqs.length === 0 ? (
                  <div style={{
                    padding: "60px 20px", textAlign: "center", color: "var(--text3)",
                  }}>
                    <InboxIcon size={32} color="var(--text3)" style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
                    <div style={{ fontSize: 13, marginBottom: 6 }}>No RFQs yet</div>
                    <div style={{ fontSize: 11 }}>Connect Gmail and start the system, or paste an email in the Test tab</div>
                  </div>
                ) : groupedByClient.map(([clientName, clientRfqs]) => {
                  const isClientCollapsed = collapsedClients.has(clientName);
                  const highCount = clientRfqs.filter(r => r.priority === 'high').length;
                  const obsCount  = clientRfqs.filter(r => r.isObsolete).length;
                  return (
                    <div key={clientName}>
                      {/* ── Client group header ── */}
                      <div
                        onClick={() => toggleClient(clientName)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 16px", background: "var(--surface2)",
                          borderBottom: "1px solid var(--border)",
                          cursor: "pointer", userSelect: "none",
                        }}
                      >
                        <span style={{ fontSize: 10, color: "var(--text3)", width: 12 }}>{isClientCollapsed ? "▶" : "▼"}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flex: 1 }}>{clientName}</span>
                        <span style={{ fontSize: 9, color: "var(--text3)", marginRight: 6 }}>{clientRfqs.length} part{clientRfqs.length !== 1 ? "s" : ""}</span>
                        {highCount > 0 && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "#F8717120", color: "var(--red)", border: "1px solid #F8717130" }}>HIGH</span>}
                        {obsCount > 0 && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "#FB923C20", color: "#FB923C", border: "1px solid #FB923C30", marginLeft: 4 }}>OBS</span>}
                      </div>
                      {/* ── Parts rows ── */}
                      {!isClientCollapsed && clientRfqs.map((rfq, i) => {
                      const st = STATUS[rfq.status] || STATUS.new;
                      const isSelected = selectedRfq?.id === rfq.id;
                      const isChecked  = !!checkedRfqIds[rfq.id];
                      return (
                    <div key={rfq.id}>
                    <div
                      onClick={() => setSelectedRfq(isSelected ? null : rfq)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "28px 20px 1fr 1.1fr 0.5fr 0.7fr 0.55fr 0.5fr 0.85fr 0.45fr 62px",
                        gap: 6, padding: "10px 16px",
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                        background: isSelected
                          ? "var(--surface2)"
                          : rfq.isObsolete
                            ? (rfq.humanLoop ? "#FB923C08" : "#FBBF2406")
                            : "transparent",
                        borderRight: rfq.isObsolete ? "3px solid #FB923C60" : "none",
                        transition: "background 0.15s",
                        animation: `slideIn 0.3s ease ${i * 0.05}s both`,
                      }}
                    >
                      {/* Checkbox */}
                      <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => setCheckedRfqIds(prev => {
                            const next = { ...prev };
                            if (e.target.checked) next[rfq.id] = true;
                            else delete next[rfq.id];
                            return next;
                          })}
                          style={{ cursor: "pointer", accentColor: "var(--accent)" }}
                        />
                      </div>
                      {/* Priority dot + human-loop indicator */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, paddingTop: 2 }}>
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: rfq.priority === "high" ? "var(--red)" : rfq.priority === "medium" ? "var(--amber)" : "var(--green)",
                          boxShadow: rfq.priority === "high" ? "0 0 8px var(--red)" : "none",
                        }} />
                        {rfq.humanLoop && (
                          <div title="Awaiting manual approval" style={{ fontSize: 8, lineHeight: 1 }}>🔍</div>
                        )}
                      </div>
                      {/* customer */}
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{rfq.customerName}</div>
                      {/* part number + OBS badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: 5, direction: "ltr" }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--accent)" }}>{rfq.partNumber}</span>
                        {rfq.isObsolete && (
                          <span style={{
                            fontSize: 7, fontWeight: 800, padding: "1px 4px", borderRadius: 3,
                            background: "#FB923C25", color: "#FB923C",
                            border: "1px solid #FB923C50", letterSpacing: "0.04em",
                          }}>OBS</span>
                        )}
                      </div>
                      {/* quantity */}
                      <div style={{ fontSize: 11, fontWeight: 500, direction: "ltr", textAlign: "left" }}>
                        {rfq.quantity?.toLocaleString()}
                      </div>
                      {/* delivery date */}
                      <div style={{ fontSize: 10, color: rfq.deliveryDate ? "var(--text2)" : "var(--red)" }}>
                        {rfq.deliveryDate || "⚠ Missing"}
                      </div>
                      {/* accepts alternatives */}
                      <div>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                          background: rfq.acceptsAlternatives === "Yes" ? "#34D39915" : rfq.acceptsAlternatives === "No" ? "#F8717115" : "var(--surface2)",
                          color: rfq.acceptsAlternatives === "Yes" ? "var(--green)" : rfq.acceptsAlternatives === "No" ? "var(--red)" : "var(--text3)",
                          border: `1px solid ${rfq.acceptsAlternatives === "Yes" ? "#34D39925" : rfq.acceptsAlternatives === "No" ? "#F8717125" : "var(--border)"}`,
                        }}>{rfq.acceptsAlternatives}</span>
                      </div>
                      {/* target price */}
                      <div style={{ fontSize: 11, direction: "ltr", textAlign: "left", color: rfq.targetPrice != null ? "var(--text)" : "var(--text3)" }}>
                        {rfq.targetPrice != null ? `$${rfq.targetPrice}` : "—"}
                      </div>
                      {/* special requirements */}
                      <div style={{
                        fontSize: 9, color: rfq.specialRequirements ? "var(--amber)" : "var(--text3)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{rfq.specialRequirements || "—"}</div>
                      {/* Status badge */}
                      <div>
                        <span style={{
                          fontSize: 8, fontWeight: 600, padding: "2px 5px", borderRadius: 4,
                          background: st.bg, color: st.color, border: `1px solid ${st.color}20`,
                        }}>{st.label}</span>
                      </div>
                      {/* Actions: ◂ back | ▸ advance */}
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ display: "flex", gap: 3, alignItems: "center" }}
                      >
                        {rfq.status !== 'new' && (
                          <button
                            title="Step back (reason required)"
                            onClick={() => { setBackModal({ rfqId: rfq.id }); setBackComment(''); }}
                            style={{
                              background: "var(--surface2)", border: "1px solid var(--border)",
                              borderRadius: 6, padding: "3px 6px", cursor: "pointer",
                              fontSize: 10, color: "var(--text3)",
                            }}
                          >◂</button>
                        )}
                        {rfq.status !== 'completed' && (
                          <button
                            title="Advance status"
                            onClick={() => advanceStatus(rfq.id)}
                            style={{
                              background: "var(--surface2)", border: "1px solid var(--border)",
                              borderRadius: 6, padding: "3px 6px", cursor: "pointer",
                              fontSize: 10, color: "var(--accent)",
                            }}
                          >▸</button>
                        )}
                        <button
                          title="Delete this item"
                          onClick={() => {
                            setRfqs(prev => prev.filter(r => r.id !== rfq.id));
                            if (selectedRfq?.id === rfq.id) setSelectedRfq(null);
                            setCheckedRfqIds(prev => { const n = {...prev}; delete n[rfq.id]; return n; });
                          }}
                          style={{
                            background: "none", border: "none", borderRadius: 6,
                            padding: "3px 5px", cursor: "pointer",
                            fontSize: 10, color: "var(--text3)",
                            opacity: 0.5,
                            transition: "opacity 0.15s, color 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = "var(--red)"; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.color = "var(--text3)"; }}
                        >×</button>
                      </div>
                    </div>
                    {/* ── Inline detail panel ── */}
                    {selectedRfq?.id === rfq.id && (() => {
                      const sr = rfqs.find(r => r.id === rfq.id) || rfq;
                      const responses  = sr.supplierResponses || [];
                      const bestScore  = responses.length ? Math.max(...responses.map(r => r.score ?? 0)) : null;
                      const scoreColor = (s) => s >= 70 ? "var(--green)" : s >= 40 ? "var(--amber)" : "var(--red)";
                      return (
                        <div style={{
                          margin: "0 8px 8px 8px",
                          background: "var(--surface)",
                          border: `1px solid ${sr.isObsolete ? "#FB923C40" : "var(--accent)30"}`,
                          borderRadius: 10, padding: 18,
                          animation: "slideIn 0.2s ease",
                        }}>
                          {/* Header */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                            <div>
                              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>
                                {sr.id} · {sr.sender}{sr.fromEmail && ` · ${sr.fromEmail}`}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 17, fontWeight: 700, direction: "ltr", color: "var(--accent)" }}>{sr.partNumber}</span>
                                {sr.isObsolete && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4, background: "#FB923C25", color: "#FB923C", border: "1px solid #FB923C50" }}>OBSOLETE</span>}
                                {sr.humanLoop && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: "#38BDF820", color: "var(--accent)", border: "1px solid #38BDF840" }}>🔍 HUMAN REVIEW</span>}
                              </div>
                            </div>
                            <button onClick={() => setSelectedRfq(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                              <XIcon size={16} color="var(--text3)" />
                            </button>
                          </div>
                          {/* Fields grid */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
                            {[
                              { l: "1. Customer",      v: sr.customerName,              c: "var(--text)" },
                              { l: "2. Part Number",   v: sr.partNumber,                c: "var(--accent)", ltr: true },
                              { l: "3. Quantity",      v: sr.quantity?.toLocaleString(),c: "var(--text)" },
                              { l: "4. Delivery Date", v: sr.deliveryDate || "⚠ Not specified", c: sr.deliveryDate ? "var(--text)" : "var(--red)" },
                            ].map((f, fi) => (
                              <div key={fi} style={{ background: "var(--surface2)", borderRadius: 8, padding: "9px 11px" }}>
                                <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, fontWeight: 600 }}>{f.l}</div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: f.c, direction: f.ltr ? "ltr" : "rtl", textAlign: f.ltr ? "left" : "right" }}>{f.v}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "9px 11px" }}>
                              <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, fontWeight: 600 }}>5. Accepts Alternatives?</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: sr.acceptsAlternatives === "Yes" ? "var(--green)" : sr.acceptsAlternatives === "No" ? "var(--red)" : "var(--text3)" }}>
                                {sr.acceptsAlternatives === "Yes" ? "✓ Yes" : sr.acceptsAlternatives === "No" ? "✗ No" : "— Not specified"}
                              </div>
                            </div>
                            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "9px 11px" }}>
                              <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, fontWeight: 600 }}>6. Target Price</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: sr.targetPrice != null ? "var(--green)" : "var(--text3)", direction: "ltr", textAlign: "left" }}>
                                {sr.targetPrice != null ? `$${sr.targetPrice}` : "—"}
                              </div>
                            </div>
                            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "9px 11px" }}>
                              <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, fontWeight: 600 }}>Priority</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: sr.priority === "high" ? "var(--red)" : sr.priority === "medium" ? "var(--amber)" : "var(--green)" }}>
                                {sr.priority === "high" ? "🔴 High" : sr.priority === "medium" ? "🟡 Medium" : "🟢 Low"}
                              </div>
                            </div>
                          </div>
                          {sr.specialRequirements && (
                            <div style={{ background: "#FBBF2408", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "var(--amber)", borderRight: "3px solid var(--amber)", marginBottom: 10 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text3)", display: "block", marginBottom: 3 }}>7. Special Requirements</span>
                              {sr.specialRequirements}
                            </div>
                          )}
                          {sr.summary && (
                            <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic", paddingBottom: 10 }}>AI Summary: {sr.summary}</div>
                          )}
                          {/* Supplier responses */}
                          {responses.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>
                                📊 Supplier Responses ({responses.length}) · Best: <span style={{ color: scoreColor(bestScore) }}>{bestScore}/100</span>
                              </div>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, direction: "ltr" }}>
                                  <thead>
                                    <tr style={{ background: "var(--surface2)", color: "var(--text3)", fontSize: 9, textTransform: "uppercase" }}>
                                      {["Supplier","Unit Price","Lead Time","Avail Qty","MOQ","Score","Notes"].map(h => (
                                        <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {responses.map((resp, ri) => {
                                      const isBest = resp.score === bestScore && bestScore != null;
                                      return (
                                        <tr key={ri} style={{ background: isBest ? "#34D39910" : "transparent", borderBottom: "1px solid var(--border)", borderRight: isBest ? "3px solid var(--green)" : "none" }}>
                                          <td style={{ padding: "5px 8px", fontWeight: 600, color: "var(--text)" }}>{isBest && <span style={{ color: "var(--green)" }}>★ </span>}{resp.supplierName || "—"}</td>
                                          <td style={{ padding: "5px 8px", color: resp.quotedPrice != null ? "var(--green)" : "var(--text3)" }}>{resp.quotedPrice != null ? `$${resp.quotedPrice}` : "—"}{resp.currency && resp.currency !== "USD" && <span style={{ fontSize: 8, color: "var(--text3)", marginLeft: 3 }}>{resp.currency}</span>}</td>
                                          <td style={{ padding: "5px 8px", color: resp.leadTimeDays === 0 ? "var(--green)" : "var(--text2)" }}>{resp.leadTimeDays === 0 ? "In Stock" : resp.leadTimeDays != null ? `${resp.leadTimeDays}d` : "—"}</td>
                                          <td style={{ padding: "5px 8px", color: "var(--text2)" }}>{resp.availableQty != null ? resp.availableQty.toLocaleString() : resp.inStock ? "✓ Stock" : "—"}</td>
                                          <td style={{ padding: "5px 8px", color: "var(--text3)" }}>{resp.moq != null ? resp.moq.toLocaleString() : "—"}</td>
                                          <td style={{ padding: "5px 8px" }}><span style={{ fontWeight: 700, color: scoreColor(resp.score ?? 0), background: `${scoreColor(resp.score ?? 0)}15`, padding: "2px 6px", borderRadius: 4 }}>{resp.score ?? "—"}</span></td>
                                          <td style={{ padding: "5px 8px", fontSize: 9, color: "var(--text3)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resp.notes || "—"}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          {/* Status history */}
                          {(sr.statusHistory || []).length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 5, textTransform: "uppercase" }}>Status History</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {sr.statusHistory.map((h, hi) => (
                                  <div key={hi} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--text2)", background: "var(--surface2)", borderRadius: 6, padding: "5px 10px" }}>
                                    <span style={{ fontSize: 9, color: "var(--text3)", minWidth: 55 }}>{h.ts}</span>
                                    <span style={{ color: STATUS[h.from]?.color }}>{STATUS[h.from]?.label || h.from}</span>
                                    <span style={{ color: "var(--text3)" }}>→</span>
                                    <span style={{ color: STATUS[h.to]?.color }}>{STATUS[h.to]?.label || h.to}</span>
                                    <span style={{ color: "var(--text3)" }}>·</span>
                                    <span style={{ fontStyle: "italic", color: "var(--text3)" }}>{h.comment}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Actions */}
                          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {sr.status !== 'completed' && (
                              <button onClick={() => advanceStatus(sr.id)} style={{ padding: "8px 18px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Advance ▸</button>
                            )}
                            {sr.status !== 'new' && (
                              <button onClick={() => { setBackModal({ rfqId: sr.id }); setBackComment(''); }} style={{ padding: "8px 14px", borderRadius: 8, background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 11 }}>◂ Back</button>
                            )}
                            <button
                              onClick={() => sendToSuppliers(sr)}
                              disabled={sendingSuppliers || !mailToken || !supplierList.length}
                              title={!mailToken ? "Connect your mailbox first" : !supplierList.length ? "Add suppliers in Settings" : sr.humanLoop ? "Remove review flag first" : "Send to all suppliers"}
                              style={{ padding: "8px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: (sendingSuppliers || !mailToken || !supplierList.length) ? "var(--surface3)" : sr.humanLoop ? "#FBBF2420" : "#F472B620", color: (sendingSuppliers || !mailToken || !supplierList.length) ? "var(--text3)" : sr.humanLoop ? "var(--amber)" : "var(--pink)", border: `1px solid ${sr.humanLoop ? "#FBBF2440" : "#F472B640"}` }}
                            >
                              <SendIcon size={12} />{sendingSuppliers ? "Sending…" : `Send to Suppliers (${supplierList.length})`}
                            </button>
                            <button onClick={() => toggleHumanLoop(sr.id)} style={{ padding: "8px 12px", borderRadius: 8, fontSize: 11, cursor: "pointer", background: sr.humanLoop ? "#38BDF820" : "var(--surface2)", color: sr.humanLoop ? "var(--accent)" : "var(--text3)", border: `1px solid ${sr.humanLoop ? "#38BDF840" : "var(--border)"}` }}>
                              {sr.humanLoop ? "🔍 Remove Review" : "🔍 Flag for Review"}
                            </button>
                            <button onClick={() => { const text = `Customer: ${sr.customerName}\nPart: ${sr.partNumber}\nQty: ${sr.quantity}\nDelivery: ${sr.deliveryDate || "—"}\nAlts: ${sr.acceptsAlternatives}\nTarget: ${sr.targetPrice != null ? "$"+sr.targetPrice : "—"}\nReqs: ${sr.specialRequirements || "—"}`; navigator.clipboard?.writeText(text); addLog("📋 Copied", "success"); }} style={{ padding: "8px 14px", borderRadius: 8, background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 11 }}>📋 Copy</button>
                          </div>
                        </div>
                      );
                    })()}
                    </div>
                      );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* ━━━ INBOX TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "inbox" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--accent)" }}>
              📬 Live Inbox
            </h2>
            <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 20 }}>
              Connect to Gmail or Outlook, filter messages, and process emails through the LLM engine.
            </p>

            {/* Connection bar */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 16, marginBottom: 12,
              display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
            }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ id: "gmail", label: "Gmail" }, { id: "outlook", label: "Outlook" }].map(p => (
                  <button
                    key={p.id}
                    onClick={() => { if (mailToken) disconnectMailbox(); setMailProvider(p.id); setMailMessages([]); }}
                    style={{
                      padding: "8px 14px", borderRadius: 8,
                      background: mailProvider === p.id ? "var(--accent)" : "var(--surface2)",
                      color: mailProvider === p.id ? "#000" : "var(--text2)",
                      border: `1px solid ${mailProvider === p.id ? "var(--accent)" : "var(--border)"}`,
                      cursor: "pointer", fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {!mailToken ? (
                <>
                  <button
                    onClick={connectMailbox}
                    disabled={mailLoading}
                    style={{
                      padding: "8px 16px", borderRadius: 8,
                      background: "var(--green)", color: "#000",
                      border: "none", cursor: mailLoading ? "default" : "pointer",
                      fontSize: 11, fontWeight: 700,
                    }}
                  >
                    {mailLoading ? "Connecting..." : `🔑 Connect to ${mailProvider === 'gmail' ? 'Gmail' : 'Outlook'}`}
                  </button>
                  {mailProvider === 'outlook' && (
                    <button
                      onClick={resetOutlookCache}
                      title="Clear MSAL cache — try this if the popup does not open"
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: "var(--surface2)", color: "var(--text2)",
                        border: "1px solid var(--border)", cursor: "pointer",
                        fontSize: 10, fontWeight: 600,
                      }}
                    >
                      🧹 Clear MSAL
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={disconnectMailbox}
                  style={{
                    padding: "8px 16px", borderRadius: 8,
                    background: "var(--surface2)", color: "var(--text2)",
                    border: "1px solid var(--border)", cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                  }}
                >
                  🔌 Disconnect
                </button>
              )}

              <input
                value={mailSearch}
                onChange={e => setMailSearch(e.target.value)}
                placeholder={mailProvider === 'gmail' ? 'subject:(RFQ) newer_than:7d' : 'RFQ'}
                style={{
                  flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 11, outline: "none",
                  direction: "ltr", fontFamily: "monospace",
                }}
              />

              <button
                onClick={refreshMailbox}
                disabled={!mailToken || mailLoading}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  background: (!mailToken || mailLoading) ? "var(--surface3)" : "var(--accent)",
                  color: (!mailToken || mailLoading) ? "var(--text3)" : "#000",
                  border: "none", cursor: (!mailToken || mailLoading) ? "default" : "pointer",
                  fontSize: 11, fontWeight: 700,
                }}
              >
                {mailLoading ? "..." : "🔄 Load Messages"}
              </button>
            </div>

            {/* Message list */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {mailMessages.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  {mailToken ? "No messages — try a different search query" : "Not connected to a mailbox"}
                </div>
              ) : (
                mailMessages.map((m, i) => (
                  <div key={m.id} style={{
                    padding: "14px 18px",
                    borderBottom: i < mailMessages.length - 1 ? "1px solid var(--border)" : "none",
                    display: "flex", gap: 12, alignItems: "center",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
                        {m.subject}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4, direction: "ltr", textAlign: "right" }}>
                        {m.from} · {m.date && new Date(m.date).toLocaleString("en-GB")}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.snippet}
                      </div>
                    </div>
                    <button
                      onClick={() => processMailMessage(m)}
                      disabled={isProcessing || !providerReady}
                      title={!providerReady ? "Configure an LLM provider first" : "Process via LLM"}
                      style={{
                        padding: "8px 14px", borderRadius: 8,
                        background: (!providerReady || isProcessing) ? "var(--surface3)" : "var(--amber)",
                        color: (!providerReady || isProcessing) ? "var(--text3)" : "#000",
                        border: "none", cursor: (!providerReady || isProcessing) ? "default" : "pointer",
                        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                      }}
                    >
                      ▶ Process
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ━━━ CONFIG TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "config" && (
          <div style={{ animation: "slideIn 0.3s ease", maxWidth: 700 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24, color: "var(--accent)" }}>
              ⚙️ System Settings
            </h2>

            {/* LLM Provider */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                🤖 LLM Provider
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    style={{
                      padding: "8px 16px", borderRadius: 8,
                      background: provider === p.id ? "var(--accent)" : "var(--surface2)",
                      color: provider === p.id ? "#000" : "var(--text2)",
                      border: `1px solid ${provider === p.id ? "var(--accent)" : "var(--border)"}`,
                      cursor: "pointer", fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {provider === 'anthropic' && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Anthropic API Key (stored in browser localStorage only)</div>
                  <input
                    type="password"
                    value={anthropicApiKey}
                    onChange={e => setAnthropicApiKey(e.target.value)}
                    placeholder="sk-ant-api03-..."
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Model</div>
                  <input
                    value={anthropicModel}
                    onChange={e => setAnthropicModel(e.target.value)}
                    placeholder="claude-sonnet-4-6"
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                </div>
              )}

              {provider === 'openai' && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Base URL (OpenAI-compatible — OpenAI / Groq / Together / LM Studio etc.)</div>
                  <input
                    value={openaiBaseUrl}
                    onChange={e => setOpenaiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>API Key</div>
                  <input
                    type="password"
                    value={openaiApiKey}
                    onChange={e => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Model</div>
                  <input
                    value={openaiModel}
                    onChange={e => setOpenaiModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                </div>
              )}

              {provider === 'ollama' && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Ollama Base URL (local default)</div>
                  <input
                    value={ollamaBaseUrl}
                    onChange={e => setOllamaBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Model (make sure <code>ollama pull</code> has been run for this model)</div>
                  <input
                    value={ollamaModel}
                    onChange={e => setOllamaModel(e.target.value)}
                    placeholder="llama3.1"
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--amber)", lineHeight: 1.5 }}>
                    ⚠️ If the browser blocks CORS, start Ollama with: <code style={{fontFamily:"monospace"}}>OLLAMA_ORIGINS=&quot;*&quot; ollama serve</code>
                  </div>
                </div>
              )}

              {provider === 'openrouter' && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>OpenRouter API Key — get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>openrouter.ai/keys</a></div>
                  <input
                    type="password"
                    value={openrouterApiKey}
                    onChange={e => setOpenrouterApiKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Model</div>
                  <select
                    value={OPENROUTER_MODELS.some(m => m.id === openrouterModel) ? openrouterModel : '__custom__'}
                    onChange={e => { if (e.target.value !== '__custom__') setOpenrouterModel(e.target.value); }}
                    style={{
                      padding: "10px 14px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr", cursor: "pointer",
                    }}
                  >
                    {OPENROUTER_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label} — {m.id}</option>
                    ))}
                    <option value="__custom__">Custom model ID…</option>
                  </select>
                  {!OPENROUTER_MODELS.some(m => m.id === openrouterModel) && (
                    <input
                      value={openrouterModel}
                      onChange={e => setOpenrouterModel(e.target.value)}
                      placeholder="provider/model-name"
                      style={{
                        padding: "10px 14px", borderRadius: 8,
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 12, outline: "none",
                        direction: "ltr", fontFamily: "monospace",
                      }}
                    />
                  )}
                  <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
                    Access 300+ models through one API. Pricing varies per model — check <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>openrouter.ai/models</a>.
                  </div>
                </div>
              )}

              <div style={{ fontSize: 10, color: providerReady ? "var(--green)" : "var(--text3)", marginTop: 12 }}>
                {providerReady ? `✓ ${provider} provider ready` : "⚠ Configuration incomplete"}
              </div>
            </div>

            {/* Mailbox OAuth Client IDs */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                📬 Live Mailboxes (OAuth)
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 14, lineHeight: 1.7 }}>
                Add Client IDs to connect to your Gmail and Outlook mailboxes. All OAuth flows run in the browser — no tokens are sent to any server.
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>Google OAuth Client ID (Web application)</div>
                <input
                  value={googleClientId}
                  onChange={e => setGoogleClientId(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 12, outline: "none",
                    direction: "ltr", fontFamily: "monospace",
                  }}
                />
                <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
                  1. Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Google Cloud Console → Credentials</a><br />
                  2. Edit your <b>Web application</b> OAuth 2.0 Client ID<br />
                  3. Under <b>Authorized JavaScript origins</b> add exactly:
                </div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 4,
                  background: "var(--surface3)", borderRadius: 6, padding: "7px 10px",
                  border: "1px solid var(--accent)40",
                }}>
                  <code style={{ flex: 1, fontSize: 11, direction: "ltr", color: "var(--accent)", fontFamily: "monospace" }}>
                    {typeof window !== "undefined" ? window.location.origin : "http://localhost:8080"}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(typeof window !== "undefined" ? window.location.origin : "http://localhost:8080"); addLog("📋 Origin copied", "success"); }}
                    style={{ padding: "3px 8px", borderRadius: 5, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}
                  >Copy</button>
                </div>
                <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
                  4. Also enable the <b>Gmail API</b> for the project (APIs &amp; Services → Library → Gmail API → Enable)
                </div>

                <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 8 }}>Microsoft (Azure AD) Client ID</div>
                <input
                  value={msClientId}
                  onChange={e => setMsClientId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 12, outline: "none",
                    direction: "ltr", fontFamily: "monospace",
                  }}
                />
                <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 4 }}>Microsoft Tenant ID (or domain — required if the app is single-tenant)</div>
                <input
                  value={msTenantId}
                  onChange={e => setMsTenantId(e.target.value)}
                  placeholder="contoso.onmicrosoft.com or GUID — leave blank for multi-tenant"
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 12, outline: "none",
                    direction: "ltr", fontFamily: "monospace",
                  }}
                />
                <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
                  Create in <a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Microsoft Entra</a> → App registrations → Single-page application.
                  Redirect URI: <code style={{ direction: "ltr", fontFamily: "monospace" }}>{typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"}</code>.
                  Microsoft Graph permissions: <code>Mail.Read</code>, <code>User.Read</code> (delegated).
                  Find the Tenant ID in the app registration Overview (Directory (tenant) ID).
                </div>
              </div>
            </div>

            {/* Info: real mailbox connection happens in Inbox tab */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 16, marginBottom: 16,
              fontSize: 11, color: "var(--text2)", lineHeight: 1.7,
            }}>
              💡 To connect to Gmail / Outlook, go to the <button onClick={() => setActiveTab('inbox')} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit", textDecoration: "underline" }}>Inbox tab</button>. Current connection status: {mailToken ? <span style={{ color: "var(--green)" }}>✓ Connected ({mailProvider})</span> : <span style={{ color: "var(--red)" }}>Not connected</span>}
            </div>

            {/* Search Query */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                🔍 Gmail Search Query
              </div>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 12 }}>
                Gmail search query — modify as needed
              </div>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 8,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 12, outline: "none",
                  direction: "ltr",
                }}
              />
            </div>

            {/* Poll Interval */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                ⏱️ Poll Interval
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {[30, 60, 120, 300].map(sec => (
                  <button
                    key={sec}
                    onClick={() => setPollInterval(sec)}
                    style={{
                      padding: "8px 16px", borderRadius: 8,
                      background: pollInterval === sec ? "var(--accent)" : "var(--surface2)",
                      color: pollInterval === sec ? "#000" : "var(--text2)",
                      border: `1px solid ${pollInterval === sec ? "var(--accent)" : "var(--border)"}`,
                      cursor: "pointer", fontSize: 12, fontWeight: 600,
                    }}
                  >
                    {sec < 60 ? `${sec}s` : `${sec / 60}m`}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Supplier List ───────────────────────────────────────── */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <UsersIcon size={15} color="var(--pink)" />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Supplier List</div>
                {supplierList.length > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 10,
                    background: "#F472B620", color: "var(--pink)", border: "1px solid #F472B640",
                  }}>{supplierList.length}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6 }}>
                Email addresses that will receive RFQ outreach emails. Sending uses your connected mailbox.
              </div>

              {/* Existing suppliers */}
              {supplierList.length === 0 ? (
                <div style={{
                  padding: "16px 0", textAlign: "center", color: "var(--text3)", fontSize: 11,
                  borderBottom: "1px solid var(--border)", marginBottom: 14,
                }}>
                  No suppliers yet — add one below
                </div>
              ) : (
                <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                  {supplierList.map((sup, idx) => (
                    <div key={idx} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: "var(--surface2)", borderRadius: 8, padding: "8px 14px",
                      border: "1px solid var(--border)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: "#F472B620", border: "1px solid #F472B640",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, color: "var(--pink)",
                        }}>
                          {sup.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{sup.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text3)", direction: "ltr", textAlign: "left" }}>{sup.email}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeSupplier(idx)}
                        title="Remove supplier"
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          padding: 4, borderRadius: 4, color: "var(--text3)",
                          display: "flex", alignItems: "center",
                        }}
                      ><XIcon size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new supplier */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>Supplier Name</div>
                  <input
                    value={newSupplierName}
                    onChange={e => setNewSupplierName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSupplier()}
                    placeholder="e.g. Arrow Electronics"
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1.2 }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>Email Address</div>
                  <input
                    value={newSupplierEmail}
                    onChange={e => setNewSupplierEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSupplier()}
                    placeholder="rfq@supplier.com"
                    type="email"
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                      direction: "ltr",
                    }}
                  />
                </div>
                <button
                  onClick={addSupplier}
                  disabled={!newSupplierName.trim() || !newSupplierEmail.trim() || !newSupplierEmail.includes('@')}
                  style={{
                    padding: "9px 18px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    background: (newSupplierName.trim() && newSupplierEmail.includes('@'))
                      ? "#F472B6" : "var(--surface3)",
                    color: (newSupplierName.trim() && newSupplierEmail.includes('@'))
                      ? "#000" : "var(--text3)",
                    border: "none", cursor: "pointer", whiteSpace: "nowrap",
                    transition: "all 0.15s",
                  }}
                >+ Add</button>
              </div>
            </div>

            {/* ── FX rates for supplier scoring ───────────────────────── */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Exchange Rates</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6 }}>
                Target prices are extracted in USD. Supplier quotes in other currencies are converted
                using these approximate rates before price scoring — update them periodically.
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>1 EUR = $ USD</div>
                  <input
                    type="number" step="0.01" min="0"
                    value={fxRates.EUR}
                    onChange={e => setFxRates(prev => ({ ...prev, EUR: parseFloat(e.target.value) || 0 }))}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>1 ILS = $ USD</div>
                  <input
                    type="number" step="0.01" min="0"
                    value={fxRates.ILS}
                    onChange={e => setFxRates(prev => ({ ...prev, ILS: parseFloat(e.target.value) || 0 }))}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Start/Stop */}
            <div style={{
              background: "var(--surface)", border: `1px solid ${isRunning ? "var(--green)30" : "var(--border)"}`,
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                🚀 System Control
              </div>
              {/* Mode toggle */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() => setManualMode(false)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    background: !manualMode ? "var(--accent)" : "var(--surface2)",
                    color: !manualMode ? "#000" : "var(--text2)",
                    border: `1px solid ${!manualMode ? "var(--accent)" : "var(--border)"}`,
                  }}
                >📡 Auto (Live Inbox)</button>
                <button
                  onClick={() => setManualMode(true)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    background: manualMode ? "#A78BFA" : "var(--surface2)",
                    color: manualMode ? "#000" : "var(--text2)",
                    border: `1px solid ${manualMode ? "#A78BFA" : "var(--border)"}`,
                  }}
                >✋ Manual</button>
              </div>
              {manualMode && (
                <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6, padding: "8px 12px", borderRadius: 8, background: "#A78BFA10", border: "1px solid #A78BFA30" }}>
                  Manual mode — no mailbox needed. Process emails via the <button onClick={() => setActiveTab('test')} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit", textDecoration: "underline", fontSize: 10 }}>Test tab</button> (paste / upload / drag .eml).
                </div>
              )}
              <button
                onClick={() => {
                  if (!manualMode && !mailToken) {
                    addLog("⚠️ Connect to a mailbox first, or switch to Manual mode", "warning");
                    setActiveTab('inbox');
                    return;
                  }
                  if (!providerReady) {
                    addLog("⚠️ Configure an LLM provider before starting", "warning");
                    return;
                  }
                  setIsRunning(!isRunning);
                  addLog(isRunning ? "⏹️ System stopped" : (manualMode ? "▶️ System started — manual mode (paste/upload emails in Test tab)" : `▶️ System started — polling every ${pollInterval} seconds`), "info");
                }}
                style={{
                  padding: "14px 32px", borderRadius: 12,
                  background: isRunning
                    ? "linear-gradient(135deg, #F87171, #EF4444)"
                    : "linear-gradient(135deg, #34D399, #10B981)",
                  color: "#fff", border: "none", cursor: "pointer",
                  fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 10,
                  boxShadow: isRunning ? "0 4px 20px #F8717140" : "0 4px 20px #34D39940",
                }}
              >
                {isRunning ? <><PauseIcon size={16} color="#fff" /> Stop System</> : <><PlayIcon size={16} color="#fff" /> Start System</>}
              </button>
            </div>
          </div>
        )}

        {/* ━━━ TEST TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "test" && (
          <div style={{ animation: "slideIn 0.3s ease", maxWidth: 800 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--amber)" }}>
              ⚡ Manual Test
            </h2>
            <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 20 }}>
              Paste the body of an RFQ email to test the processing engine — Claude AI will extract the data automatically.
            </p>

            {/* Example email picker */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 16, marginBottom: 16,
              display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>
                📁 Load example email:
              </div>
              <select
                value={selectedExample}
                onChange={e => { setSelectedExample(e.target.value); loadExample(e.target.value); }}
                style={{
                  flex: 1, minWidth: 250, padding: "8px 12px", borderRadius: 8,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 11, outline: "none",
                }}
              >
                <option value="">— Select an email to load —</option>
                {EXAMPLE_EMAILS.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  if (!selectedExample) return;
                  await loadExample(selectedExample);
                  setTimeout(() => handleTestProcess(), 200);
                }}
                disabled={!selectedExample || isProcessing || !providerReady}
                title={!providerReady ? "Configure an LLM provider first in Settings" : `Load and run via ${provider}`}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  background: (!selectedExample || !providerReady) ? "var(--surface3)" : "var(--amber)",
                  color: (!selectedExample || !providerReady) ? "var(--text3)" : "#000",
                  border: "none", cursor: (!selectedExample || !providerReady) ? "default" : "pointer",
                  fontSize: 11, fontWeight: 700,
                }}
              >
                ▶ Load &amp; Run
              </button>
            </div>

            {/* ── File upload zone ── */}
            <div
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              onDrop={async e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'var(--border)';
                if (e.dataTransfer.files.length) await handleFileUpload(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--border)', borderRadius: 10, padding: 14,
                textAlign: 'center', cursor: 'pointer', marginBottom: 12,
                background: 'var(--surface)', transition: 'border-color 0.2s',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".eml,.pdf,image/jpeg,image/png,image/webp,image/jpg"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files.length) handleFileUpload(e.target.files); e.target.value = ''; }}
              />
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {testUploadLoading
                  ? '⏳ Extracting…'
                  : uploadQueue.length > 0
                    ? <span>{uploadQueue.filter(e => e.status === 'done').length}/{uploadQueue.length} file{uploadQueue.length !== 1 ? 's' : ''} &mdash; <span onClick={ev => { ev.stopPropagation(); setUploadQueue([]); setTestEmailImage(null); setUploadedFileName(''); setTestEmail(''); }} style={{ color: 'var(--red)', cursor: 'pointer', textDecoration: 'underline' }}>clear</span></span>
                    : <>📎 Drop or click — <b>.eml</b> (multiple), <b>PDF</b>, or <b>image</b></>}
              </div>
              {/* Queue meter */}
              {uploadQueue.length > 1 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                  {uploadQueue.map(entry => (
                    <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                      <span style={{ width: 14 }}>
                        {entry.status === 'done'       ? '✅'
                         : entry.status === 'processing' ? '⏳'
                         : entry.status === 'error'     ? '❌'
                         : '⏸'}
                      </span>
                      <span style={{ flex: 1, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                      {entry.status === 'processing' && (
                        <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: 'var(--accent)', animation: 'pulse 1s ease-in-out infinite', width: '60%' }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Total progress bar for multi-file */}
              {uploadQueue.length > 1 && (() => {
                const done = uploadQueue.filter(e => e.status === 'done' || e.status === 'error').length;
                const pct  = Math.round((done / uploadQueue.length) * 100);
                return (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ width: '100%', height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.3s ease', borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'right', marginTop: 2 }}>{pct}%</div>
                  </div>
                );
              })()}
              {testEmailImage && (
                <img src={testEmailImage.dataUrl} alt="preview" style={{ maxHeight: 100, maxWidth: '100%', borderRadius: 6, marginTop: 8, objectFit: 'contain' }} />
              )}
            </div>

            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20,
            }}>
              <textarea
                value={testEmail}
                onChange={e => { setTestEmail(e.target.value); if (e.target.value) { setTestEmailImage(null); setUploadedFileName(''); } }}
                placeholder={`Paste an RFQ email here for testing...

Example:
Hi team
Purchase request
Quantity – 10000 pcs
Part: LM358DR
Manufacturer: Texas Instruments
Customer: Acme Corp
No target price
Regards`}
                style={{
                  width: "100%", minHeight: 200, padding: 16, borderRadius: 10,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 12, resize: "vertical",
                  outline: "none", lineHeight: 1.7,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                <span style={{ fontSize: 10, color: "var(--text3)" }}>
                  {testEmail.length > 0 ? `${testEmail.length} chars` : ""}
                </span>
                <button
                  onClick={handleTestProcess}
                  disabled={isProcessing || (!testEmail.trim() && !testEmailImage)}
                  style={{
                    padding: "10px 24px", borderRadius: 10,
                    background: isProcessing ? "var(--surface3)" : "var(--amber)",
                    color: isProcessing ? "var(--text3)" : "#000",
                    border: "none", cursor: isProcessing ? "default" : "pointer",
                    fontSize: 12, fontWeight: 700,
                    display: "flex", alignItems: "center", gap: 8,
                    opacity: (!testEmail.trim() && !testEmailImage) ? 0.4 : 1,
                  }}
                >
                  {isProcessing ? (
                    <>
                      <RefreshIcon size={14} style={{ animation: "spin 1s linear infinite" }} />
                      Processing...
                    </>
                  ) : (
                    <>
                      <ZapIcon size={14} color="#000" />
                      Process with Claude AI
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick test templates */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 10 }}>
                Quick test templates:
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "LM358DR (Standard)", text: "היי\n\nדרישה לכמות – 10000 י\"ח\nאין מחיר קניה / מטרה\nלבדיקתך ועדכונך\nלקוח: Acme Corp\nנדרש עד 15/06/2026\nלא מוכנים לתחליפי\n\nתודה\n\nLM358DR\nTexas Instruments" },
                  { label: "IRFS4610 (Obsolete)", text: "בוקר טוב\n\nרכיב אובסולייט – מיועד לרכש\nכמות – 21600 י\"ח\nמחיר קניה אחרון – 0.78$\nלקוח: Globex Ltd\nאספקה נדרשת: Q2 2026\nמוכנים לשקול חלופות\nדרישה מיוחדת: תאריך ייצור לא יותר מ-2 שנים\n\nתודה\n\nIRFS4610TRLPBF\nInfineon" },
                  { label: "Memory chip (Restricted)", text: "היי\n\nדרישה לרכש\nכמות – 300 י\"ח\nמחיר קניה – 33$\nלקוח: Falcon Defense Ltd\nנדרש דוח מעבדה\nאספקה: מיידית\nלא מוכנים לתחליפי – מוצר צבאי\n\nMT48LC4M16A2\nMicron\n\nתודה" },
                  { label: "Multi-part (three customers)", text: "היי\n\nמיועד לרכש\nלבדיקתך ועדכונך\n\nשם לקוח: NORTHWIND MEDICAL LTD\nתאריך נדרש: 05/04/2026\nמק\"ט ספק: UCC28089D\nכמות: 225\nמחיר מטרה: 1.200$\nדרישות: אין\n\nשם לקוח: CONTOSO SEMI\nתאריך נדרש: 05/04/2026\nמק\"ט ספק: AD8512ARZ-REEL\nכמות: 98\nמחיר מטרה: 3.980$\nמוכנים לתחליפי: כן\n\nשם לקוח: WAYNE OPTICS LTD\nתאריך נדרש: 05/07/2026\nמק\"ט ספק: THS4504DGN\nכמות: 80\nמחיר מטרה: 4.398$\nדרישות: ROHS compliance\n\nתודה" },
                ].map((tmpl, i) => (
                  <button
                    key={i}
                    onClick={() => setTestEmail(tmpl.text)}
                    style={{
                      padding: "6px 12px", borderRadius: 8,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      color: "var(--text2)", cursor: "pointer", fontSize: 10,
                      transition: "border-color 0.2s",
                    }}
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ─── Section B: Outreach Preview ─────────────────────────── */}
            <div style={{ marginTop: 28 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
                paddingBottom: 10, borderBottom: "1px solid var(--border)",
              }}>
                <span style={{
                  background: "#F472B620", color: "var(--pink)",
                  borderRadius: 6, padding: "2px 10px", fontSize: 10, fontWeight: 800,
                }}>B</span>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--pink)", margin: 0 }}>
                  Outreach Preview — Send to Suppliers
                </h3>
              </div>

              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: 18,
              }}>
                {/* RFQ selector */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "var(--text2)", fontWeight: 600, minWidth: 90 }}>Select RFQ:</label>
                  <select
                    value={testOutreachRfqId}
                    onChange={e => setTestOutreachRfqId(e.target.value)}
                    style={{
                      flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 11, outline: "none",
                    }}
                  >
                    <option value="">— Select an RFQ to preview —</option>
                    {(() => {
                      const grouped = new Map();
                      rfqs.filter(r => r.partNumber).forEach(r => {
                        const k = r.customerName || '—';
                        if (!grouped.has(k)) grouped.set(k, []);
                        grouped.get(k).push(r);
                      });
                      return [...grouped.entries()].map(([client, list]) => (
                        <optgroup key={client} label={client}>
                          {list.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.partNumber}{r.isObsolete ? " [OBS]" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>

                  {/* Human-loop toggle for selected RFQ */}
                  {testOutreachRfqId && (() => {
                    const selRfq = rfqs.find(r => r.id === testOutreachRfqId);
                    if (!selRfq) return null;
                    return (
                      <button
                        onClick={() => toggleHumanLoop(testOutreachRfqId)}
                        title={selRfq.humanLoop ? "Click to remove flag — enables automatic sending" : "Click to flag for manual review before sending"}
                        style={{
                          padding: "7px 14px", borderRadius: 8,
                          background: selRfq.humanLoop ? "#FBBF2420" : "var(--surface2)",
                          color: selRfq.humanLoop ? "var(--amber)" : "var(--text3)",
                          border: `1px solid ${selRfq.humanLoop ? "#FBBF2460" : "var(--border)"}`,
                          cursor: "pointer", fontSize: 11, fontWeight: 700,
                          display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        🔍 {selRfq.humanLoop ? "Manual Review ON" : "Manual Review OFF"}
                      </button>
                    );
                  })()}

                  {/* Send button */}
                  {testOutreachRfqId && (() => {
                    const selRfq = rfqs.find(r => r.id === testOutreachRfqId);
                    if (!selRfq) return null;
                    const canSend = mailToken && supplierList.length > 0 && !selRfq.humanLoop && !sendingSuppliers;
                    const tooltip = !mailToken ? "Connect your mailbox first"
                      : !supplierList.length ? "Add suppliers in Settings"
                      : selRfq.humanLoop ? "Remove the review flag before sending"
                      : `Send to ${supplierList.length} supplier(s)`;
                    return (
                      <button
                        onClick={() => sendToSuppliers(selRfq)}
                        disabled={!canSend}
                        title={tooltip}
                        style={{
                          padding: "7px 16px", borderRadius: 8,
                          background: canSend ? "var(--pink)" : "var(--surface3)",
                          color: canSend ? "#fff" : "var(--text3)",
                          border: "none", cursor: canSend ? "pointer" : "default",
                          fontSize: 11, fontWeight: 700,
                          display: "flex", alignItems: "center", gap: 6,
                          opacity: canSend ? 1 : 0.5,
                        }}
                      >
                        📤 {sendingSuppliers ? "Sending..." : `Send to ${supplierList.length} Supplier(s)`}
                      </button>
                    );
                  })()}
                </div>

                {/* Email HTML preview */}
                {testOutreachRfqId && rfqs.find(r => r.id === testOutreachRfqId) ? (
                  <div style={{
                    border: "1px solid var(--border)", borderRadius: 8,
                    overflow: "hidden", background: "#fff",
                  }}>
                    <div style={{
                      background: "var(--surface2)", borderBottom: "1px solid var(--border)",
                      padding: "6px 14px", fontSize: 10, color: "var(--text3)",
                      display: "flex", gap: 12,
                    }}>
                      <span>Subject: <b style={{ color: "var(--text)" }}>RFQ — {rfqs.find(r => r.id === testOutreachRfqId)?.partNumber} | {rfqs.find(r => r.id === testOutreachRfqId)?.customerName}</b></span>
                      <span style={{ marginLeft: "auto" }}>
                        {supplierList.length > 0
                          ? `Sending to: ${supplierList.map(s => s.email).join(", ")}`
                          : "⚠ No suppliers in list"}
                      </span>
                    </div>
                    <div
                      style={{ padding: 16, fontSize: 13, maxHeight: 340, overflowY: "auto" }}
                      dangerouslySetInnerHTML={{ __html: buildSupplierEmail(rfqs.find(r => r.id === testOutreachRfqId)) }}
                    />
                  </div>
                ) : (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text3)", fontSize: 11 }}>
                    Select an RFQ above to preview the outreach email
                  </div>
                )}
              </div>
            </div>

            {/* ─── Section C: Supplier Response Parse + Score ───────────── */}
            <div style={{ marginTop: 28, marginBottom: 8 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
                paddingBottom: 10, borderBottom: "1px solid var(--border)",
              }}>
                <span style={{
                  background: "#34D39920", color: "#34D399",
                  borderRadius: 6, padding: "2px 10px", fontSize: 10, fontWeight: 800,
                }}>C</span>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#34D399", margin: 0 }}>
                  Supplier Response Parse &amp; Score
                </h3>
              </div>

              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: 18,
              }}>
                {/* Supplier .eml file picker + link to RFQ */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
                    <label style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600 }}>Load example .eml:</label>
                    <select
                      value={testSupplierFile}
                      onChange={e => { setTestSupplierFile(e.target.value); loadSupplierMail(e.target.value); }}
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 11, outline: "none",
                      }}
                    >
                      <option value="">— Select .eml file —</option>
                      {SUPPLIER_MAIL_FILES.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
                    <label style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600 }}>Link to RFQ (for scoring):</label>
                    <select
                      value={testSupplierLinkRfqId}
                      onChange={e => setTestSupplierLinkRfqId(e.target.value)}
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 11, outline: "none",
                      }}
                    >
                      <option value="">— No link —</option>
                      {rfqs.filter(r => r.partNumber).map(r => (
                        <option key={r.id} value={r.id}>
                          {r.partNumber} — {r.customerName}
                          {r.targetPrice != null ? ` ($${r.targetPrice})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Raw text paste area */}
                <textarea
                  value={testSupplierText}
                  onChange={e => setTestSupplierText(e.target.value)}
                  placeholder={`Paste a supplier reply email here for analysis...

Example:
Dear Sir/Madam,
Thank you for your inquiry.
We can offer the following:
Part: LM358DR
Price: $0.85/unit
MOQ: 1000 pcs
Lead time: 4-6 weeks
Available qty: 25,000

Best regards,
Example Components Ltd`}
                  style={{
                    width: "100%", minHeight: 150, padding: 14, borderRadius: 10,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 11, resize: "vertical",
                    outline: "none", lineHeight: 1.7, marginBottom: 14,
                    boxSizing: "border-box",
                  }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={processSupplierResponse}
                    disabled={testSupplierProcessing || !testSupplierText.trim() || !providerReady}
                    title={!providerReady ? "Configure an LLM provider in Settings first" : ""}
                    style={{
                      padding: "10px 24px", borderRadius: 10,
                      background: (testSupplierProcessing || !testSupplierText.trim() || !providerReady)
                        ? "var(--surface3)" : "#34D399",
                      color: (testSupplierProcessing || !testSupplierText.trim() || !providerReady)
                        ? "var(--text3)" : "#000",
                      border: "none",
                      cursor: (testSupplierProcessing || !testSupplierText.trim() || !providerReady) ? "default" : "pointer",
                      fontSize: 12, fontWeight: 700,
                      display: "flex", alignItems: "center", gap: 8,
                      opacity: !testSupplierText.trim() ? 0.4 : 1,
                    }}
                  >
                    {testSupplierProcessing ? (
                      <>
                        <RefreshIcon size={14} style={{ animation: "spin 1s linear infinite" }} />
                        Processing...
                      </>
                    ) : (
                      <>📊 Process Response</>
                    )}
                  </button>
                </div>

                {/* Result display */}
                {testSupplierResult && (
                  <div style={{
                    marginTop: 18, padding: 16, borderRadius: 10,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    animation: "slideIn 0.3s ease",
                  }}>
                    {/* Score badge + header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                      <div style={{
                        width: 60, height: 60, borderRadius: "50%",
                        background: testSupplierResult.score >= 70 ? "#34D39920"
                          : testSupplierResult.score >= 40 ? "#FBBF2420" : "#F8718120",
                        border: `3px solid ${testSupplierResult.score >= 70 ? "#34D399"
                          : testSupplierResult.score >= 40 ? "#FBBF24" : "#F87171"}`,
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        <span style={{
                          fontSize: 18, fontWeight: 900,
                          color: testSupplierResult.score >= 70 ? "#34D399"
                            : testSupplierResult.score >= 40 ? "#FBBF24" : "#F87171",
                          lineHeight: 1,
                        }}>{testSupplierResult.score}</span>
                        <span style={{ fontSize: 8, color: "var(--text3)", fontWeight: 600 }}>/ 100</span>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                          {testSupplierResult.supplierName || "Supplier not identified"}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                          {testSupplierResult.rfqId
                            ? `Linked to ${rfqs.find(r => r.id === testSupplierResult.rfqId)?.partNumber || testSupplierResult.rfqId}`
                            : "Not linked to an RFQ"}
                           · Processed: {testSupplierResult.receivedAt}
                        </div>
                      </div>
                    </div>

                    {/* Extracted fields table */}
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <tbody>
                        {[
                          ["Part #",         testSupplierResult.partNumber],
                          ["Unit Price",     testSupplierResult.quotedPrice != null
                            ? `${testSupplierResult.quotedPrice} ${testSupplierResult.currency || "USD"}`
                              + (testSupplierResult.currency && testSupplierResult.currency !== "USD"
                                ? ` (~$${(testSupplierResult.quotedPrice * (fxRates[testSupplierResult.currency.toUpperCase()] ?? 1)).toFixed(2)} USD, used for scoring)`
                                : "")
                            : null],
                          ["Lead Time",      testSupplierResult.leadTimeDays != null
                            ? (testSupplierResult.leadTimeDays === 0 ? "In Stock" : `${testSupplierResult.leadTimeDays} days`)
                            : null],
                          ["Available Qty",  testSupplierResult.availableQty != null
                            ? testSupplierResult.availableQty.toLocaleString()
                            : null],
                          ["MOQ",            testSupplierResult.moq != null
                            ? testSupplierResult.moq.toLocaleString()
                            : null],
                          ["In Stock",       testSupplierResult.inStock != null
                            ? (testSupplierResult.inStock ? "Yes ✓" : "No")
                            : null],
                          ["Notes",          testSupplierResult.notes],
                        ].map(([label, value]) => value != null ? (
                          <tr key={label} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "6px 10px", color: "var(--text3)", fontWeight: 600, width: 120 }}>{label}</td>
                            <td style={{ padding: "6px 10px", color: "var(--text)", fontFamily: label === "Part #" ? "monospace" : "inherit" }}>
                              {String(value)}
                            </td>
                          </tr>
                        ) : null)}
                      </tbody>
                    </table>

                    {/* Score breakdown */}
                    <div style={{
                      marginTop: 12, padding: "8px 12px", borderRadius: 8,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      fontSize: 10, color: "var(--text3)",
                      display: "flex", gap: 16, flexWrap: "wrap",
                    }}>
                      <span>Score breakdown:</span>
                      <span style={{ color: "var(--accent)" }}>💰 Price (40)</span>
                      <span style={{ color: "#F472B6" }}>⏱ Lead Time (40)</span>
                      <span style={{ color: "#34D399" }}>📦 Availability (20)</span>
                      <span style={{ marginLeft: "auto" }}>
                        {testSupplierResult.score >= 70 ? "✅ Good offer" : testSupplierResult.score >= 40 ? "⚠ Average offer" : "❌ Weak offer"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ━━━ LOGS TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "logs" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--purple)" }}>
                📋 Activity Log
                {logs.length > 0 && (
                  <span style={{
                    marginRight: 10, fontSize: 11, fontWeight: 400,
                    color: "var(--text3)", background: "var(--surface2)",
                    borderRadius: 20, padding: "2px 10px",
                  }}>{logs.length}</span>
                )}
              </h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Verbose toggle */}
                <button
                  onClick={() => setVerboseLog(v => !v)}
                  title={verboseLog ? "Hide extended details" : "Show extended details (error info)"}
                  style={{
                    padding: "6px 14px", borderRadius: 8,
                    background: verboseLog ? "#A78BFA20" : "var(--surface2)",
                    color: verboseLog ? "var(--purple)" : "var(--text3)",
                    border: `1px solid ${verboseLog ? "#A78BFA50" : "var(--border)"}`,
                    cursor: "pointer", fontSize: 11, fontWeight: verboseLog ? 700 : 400,
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  🔬 {verboseLog ? "Verbose ON" : "Verbose OFF"}
                </button>
                <button
                  onClick={() => { setLogs([]); setExpandedLogId(null); }}
                  style={{
                    padding: "6px 14px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text3)", cursor: "pointer", fontSize: 11,
                  }}
                >Clear</button>
              </div>
            </div>

            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {logs.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  No log entries yet
                </div>
              ) : (
                <div style={{ maxHeight: 560, overflowY: "auto" }}>
                  {logs
                    .filter(log => verboseLog || log.type !== "info" || !log.detail)
                    .map(log => {
                      const hasDetail = !!(log.detail);
                      const isExpanded = expandedLogId === log.id;
                      const isClickable = hasDetail && verboseLog;
                      return (
                        <div key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          {/* Row */}
                          <div
                            onClick={() => isClickable && setExpandedLogId(isExpanded ? null : log.id)}
                            style={{
                              padding: "10px 18px",
                              display: "flex", alignItems: "center", gap: 12,
                              fontSize: 12,
                              animation: "slideIn 0.2s ease",
                              cursor: isClickable ? "pointer" : "default",
                              background: isExpanded ? "var(--surface2)" : "transparent",
                              transition: "background 0.15s",
                            }}
                          >
                            <span style={{
                              fontSize: 10, color: "var(--text3)", fontVariantNumeric: "tabular-nums",
                              minWidth: 65, direction: "ltr", textAlign: "left", flexShrink: 0,
                            }}>{log.time}</span>
                            <span style={{
                              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                              background: log.type === "error" ? "var(--red)"
                                : log.type === "success" ? "var(--green)"
                                : log.type === "warning" ? "var(--amber)"
                                : "var(--accent)",
                            }} />
                            <span style={{
                              flex: 1,
                              color: log.type === "error" ? "var(--red)"
                                : log.type === "success" ? "var(--green)"
                                : "var(--text2)",
                            }}>{log.message}</span>
                            {/* Expand indicator — only shown in verbose mode when detail exists */}
                            {isClickable && (
                              <span style={{
                                fontSize: 10, color: "var(--text3)", flexShrink: 0,
                                transition: "transform 0.2s",
                                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                display: "inline-block",
                              }}>▾</span>
                            )}
                            {/* Detail badge when not expanded */}
                            {hasDetail && !isClickable && (
                              <span style={{
                                fontSize: 9, color: "var(--text3)",
                                border: "1px solid var(--border)", borderRadius: 4,
                                padding: "1px 6px", flexShrink: 0,
                              }}>detail</span>
                            )}
                          </div>

                          {/* Expanded detail panel */}
                          {isExpanded && (
                            <div style={{
                              padding: "0 18px 14px 18px",
                              animation: "slideIn 0.2s ease",
                            }}>
                              <div style={{
                                background: "#0d0d1a",
                                border: "1px solid #30305a",
                                borderRadius: 8,
                                padding: 14,
                                maxHeight: 280,
                                overflowY: "auto",
                                overflowX: "auto",
                              }}>
                                <pre style={{
                                  margin: 0,
                                  fontSize: 10,
                                  color: "#c8d3f5",
                                  fontFamily: "Consolas, 'Courier New', monospace",
                                  lineHeight: 1.6,
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-all",
                                }}>
                                  {(() => {
                                    try {
                                      const d = log.detail;
                                      // Serialize Error objects
                                      if (d instanceof Error) {
                                        return JSON.stringify({ message: d.message, stack: d.stack }, null, 2);
                                      }
                                      return JSON.stringify(d, (_, v) =>
                                        v instanceof Error ? { message: v.message, stack: v.stack } : v
                                      , 2);
                                    } catch {
                                      return String(log.detail);
                                    }
                                  })()}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Back-Step Modal ──────────────────────────────────────────── */}
      {backModal && (() => {
        const rfq = rfqs.find(r => r.id === backModal.rfqId);
        const flow = ["new","processing","parsed","ready","distributed","awaiting","completed"];
        const idx  = rfq ? flow.indexOf(rfq.status) : -1;
        const prevLabel = idx > 0 ? (STATUS[flow[idx - 1]]?.label || flow[idx - 1]) : '';
        return (
          <div
            style={{
              position: "fixed", inset: 0, background: "#00000070",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 200,
            }}
            onClick={() => { setBackModal(null); setBackComment(''); }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "var(--surface)", border: "1px solid var(--border2)",
                borderRadius: 14, padding: 24, width: 380,
                boxShadow: "0 20px 60px #00000060",
                animation: "slideIn 0.2s ease",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>◂ Step Back</div>
              {rfq && (
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 16 }}>
                  <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>{rfq.partNumber}</span>
                  {' — '}
                  <span style={{ color: STATUS[rfq.status]?.color }}>{STATUS[rfq.status]?.label}</span>
                  {' → '}
                  <span style={{ color: STATUS[flow[idx-1]]?.color }}>{prevLabel}</span>
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6, fontWeight: 600 }}>
                Reason for step-back <span style={{ color: "var(--red)" }}>*</span> (required)
              </div>
              <textarea
                autoFocus
                value={backComment}
                onChange={e => setBackComment(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && backComment.trim()) {
                    revertStatus(backModal.rfqId, backComment.trim());
                  }
                  if (e.key === 'Escape') { setBackModal(null); setBackComment(''); }
                }}
                placeholder="e.g. Customer requested quantity change, error in details sent..."
                style={{
                  width: "100%", minHeight: 80, padding: "10px 12px",
                  borderRadius: 8, resize: "vertical", outline: "none",
                  background: "var(--surface2)", border: `1px solid ${backComment.trim() ? "var(--accent)" : "var(--border)"}`,
                  color: "var(--text)", fontSize: 12, lineHeight: 1.6,
                  transition: "border-color 0.15s",
                }}
              />
              <div style={{ fontSize: 9, color: "var(--text3)", marginTop: 4, marginBottom: 16 }}>
                Ctrl+Enter to confirm · Esc to cancel
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setBackModal(null); setBackComment(''); }}
                  style={{
                    padding: "8px 18px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text2)", cursor: "pointer", fontSize: 11,
                  }}
                >Cancel</button>
                <button
                  onClick={() => backComment.trim() && revertStatus(backModal.rfqId, backComment.trim())}
                  disabled={!backComment.trim()}
                  style={{
                    padding: "8px 20px", borderRadius: 8,
                    background: backComment.trim() ? "var(--red)" : "var(--surface3)",
                    color: backComment.trim() ? "#fff" : "var(--text3)",
                    border: "none", cursor: backComment.trim() ? "pointer" : "default",
                    fontSize: 11, fontWeight: 700, transition: "all 0.15s",
                  }}
                >Confirm</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
