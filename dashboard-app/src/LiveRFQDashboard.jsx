import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseEml } from "./emlParser.js";
import { callLLM, PROVIDERS, SUPPLIER_PARSE_PROMPT, scoreSupplierResponse } from "./llmClient.js";
import { exportToExcel, exportToPDF } from "./exportUtils.js";
import {
  gmailSignIn, gmailListMessages, gmailFetchRaw, gmailSendMessage,
  outlookSignIn, acquireOutlookToken, outlookListMessages, outlookFetchMessage,
  outlookSendMessage, outlookSignOut, initOutlook, clearOutlookCache,
} from "./mailProviders.js";

// List of example .eml files served from public/example-mails/
const EXAMPLE_EMAILS = [
  "rfq.eml",
  "FW_Acme Corp -TPS61045DRBR.eml",
  "FW_RH - HP -  IRFS4610TRLPBF - INFINEON -  RFQ.eml",
  "FW_RH - TI - AD - RFQ.eml",
  "FW_ 1555255LF.eml",
  "FW_ רכיבי TI.eml",
  "FW_ MT47H32M16NF-25E IT_H TR מק_ט יוניטרוניקס 104600809.eml",
  "MT47H32M16NF-25E.eml",
  "RE_ בקשה להצעת מחיר עבור.eml",
  "RE_LIAT - Globex Ltd.eml",
];

// Supplier response example files served from public/supplier-mails/
const SUPPLIER_MAIL_FILES = [
  "FW_  BOM - 535 boards.eml",
  "FW_  URGENT RFQ - STOCK   TI  .eml",
  "FW_  URGENT RFQ 1 - STOCK N.eml",
  "FW_ Momories - SKYHIGH - urgent!.eml",
  "FW_ MTFDHBL064TDQ-1AT12ATYY.eml",
  "FW_ URGENT BOM RFQ1.eml",
  "FW_ URGENT RFQ - memory .eml",
  "FW_ URGENT RFQ - STOCK .eml",
  "FW_ URGENT RFQ 1 - STOCK .eml",
  "FW_ URGENT RFQ 2 - STOCK _ Lead Time MICRON.eml",
  "FW_ URGENT RFQ.eml",
  "FW_ URGENT RFQ3 24.3.2026.eml",
];

// ─── Icons (inline SVG to avoid import issues) ─────────────────────────
const Icon = ({ d, size = 18, color = "currentColor", ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>{d}</svg>
);
const MailIcon = (p) => <Icon {...p} d={<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>} />;
const RefreshIcon = (p) => <Icon {...p} d={<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>} />;
const ZapIcon = (p) => <Icon {...p} d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>} />;
const CheckIcon = (p) => <Icon {...p} d={<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>} />;
const ClockIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>} />;
const AlertIcon = (p) => <Icon {...p} d={<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>} />;
const SendIcon = (p) => <Icon {...p} d={<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>} />;
const XIcon = (p) => <Icon {...p} d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} />;
const ChevronRight = (p) => <Icon {...p} d={<polyline points="9 18 15 12 9 6"/>} />;
const SearchIcon = (p) => <Icon {...p} d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} />;
const BoxIcon = (p) => <Icon {...p} d={<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></>} />;
const PlayIcon = (p) => <Icon {...p} d={<polygon points="5 3 19 12 5 21 5 3"/>} />;
const PauseIcon = (p) => <Icon {...p} d={<><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>} />;
const InboxIcon = (p) => <Icon {...p} d={<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>} />;
const SunIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>} />;
const MoonIcon = (p) => <Icon {...p} d={<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>} />;
const SettingsIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />;
const DownloadIcon = (p) => <Icon {...p} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} />;
const UsersIcon   = (p) => <Icon {...p} d={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>} />;
const EyeIcon     = (p) => <Icon {...p} d={<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>} />;

// ─── Constants ──────────────────────────────────────────────────────────
const STATUS = {
  new: { label: "חדש", labelEn: "New", color: "#38BDF8", bg: "#38BDF810" },
  processing: { label: "מעבד", labelEn: "Processing", color: "#FBBF24", bg: "#FBBF2410" },
  parsed: { label: "עובד", labelEn: "Parsed", color: "#A78BFA", bg: "#A78BFA10" },
  ready: { label: "מוכן להפצה", labelEn: "Ready", color: "#34D399", bg: "#34D39910" },
  distributed: { label: "הופץ", labelEn: "Distributed", color: "#F472B6", bg: "#F472B610" },
  awaiting: { label: "ממתין", labelEn: "Awaiting", color: "#FB923C", bg: "#FB923C10" },
  completed: { label: "הושלם", labelEn: "Done", color: "#4ADE80", bg: "#4ADE8010" },
  error: { label: "שגיאה", labelEn: "Error", color: "#F87171", bg: "#F8717110" },
};

const PARSE_PROMPT = `You are an RFQ (Request for Quote) email parser for rfq Projects, an electronic components distributor in Israel.
You MUST extract exactly these 8 fields for each part requested. Respond ONLY in valid JSON (no markdown, no backticks, no extra text).

{
  "parts": [
    {
      "customerName": "string - שם לקוח / end customer name (e.g. Acme Corp, Contoso Semi, Acme Corp, Globex Ltd, HP). Look for company names in the email.",
      "partNumber": "string - מק״ט יצרן / manufacturer part number (e.g. TPS61045DRBR, IRFS4610TRLPBF). This is the most important field.",
      "quantity": "number - כמות מבוקשת. Parse numbers like '10,000', '21600 י\"ח', '25K' correctly.",
      "deliveryDate": "string or null - תאריך אספקה מבוקש ע״י הלקוח. Look for dates like '05/04/2026', 'נדרש למאי', 'תוך 3 שבועות'. Return in DD/MM/YYYY format if possible, or the original Hebrew text.",
      "acceptsAlternatives": "string - האם הלקוח מוכן לתחליפי? One of: 'כן' (yes), 'לא' (no), 'לא צוין' (not specified). Look for clues like 'תחליפי', 'חלופי', 'equivalent', 'alternative', 'cross reference'. If the part is marked obsolete, assume 'לא צוין' unless explicitly stated.",
      "targetPrice": "number or null - מחיר מטרה בדולר. Parse from formats like '1.200', '0.78$', '$33', '8.80$ t/p'. Return just the number or null if not mentioned.",
      "specialRequirements": "string or null - דרישות מיוחדות. Include: obsolete status, date code limits (e.g. 'DC עד 3 שנים'), lab reports needed (e.g. 'דוח מעבדת GETS'), certifications, specific packaging, annual quantities, or any other special notes.",
      "isObsolete": "boolean - true if the part is described as obsolete, discontinued, end-of-life, or no longer manufactured. Detect ALL of these variants (including typos and Hebrew): אובסולייט, אובסולייטית, אובסולט, אובסלט, אובסולת, obs, obsolete, obsolte, obslete, absolete, obsol., EOL, end-of-life, end of life, NRND, not recommended for new designs, PDN, product discontinuation notice, discontinued, last time buy, LTB, no longer manufactured, NLM, הופסק, אין יותר בייצור. Default false if none of these appear."
    }
  ],
  "sender": "string - name of the rfq salesperson who forwarded the request",
  "priority": "high|medium|low - high if: obsolete, urgent delivery, large qty (>5000), or military/defense customer. medium: standard. low: small qty, flexible timeline.",
  "summary": "string - one line Hebrew summary of the entire request"
}

IMPORTANT RULES:
- If multiple parts are in one email, list ALL of them in the parts array.
- For the customerName: look for company names after words like 'לקוח', 'מיועד ל', or in table headers like 'שם לקוח'. Common customers: Acme Corp, Contoso Semi, Wayne Optics Ltd, Globex Ltd, Acme Corp, Contoso Semi, Northwind Medical, HP, Globex Ltd.
- For deliveryDate: look for 'ת. אספקה', 'נדרש ל', 'תאריך נדרש', or date columns in tables.
- For acceptsAlternatives: default to 'לא צוין' unless the email explicitly discusses alternatives.
- For specialRequirements: combine ALL special notes — obsolete status, DC limits, lab reports, annual qty info, etc.
- For isObsolete: when in doubt lean toward true — a false negative (missing an obsolete flag) is worse than a false positive.
- Never invent data. If a field is genuinely not in the email, use null or 'לא צוין' as appropriate.`;

// ─── Gmail search via MCP in Claude API ─────────────────────────────────
async function searchGmail(query) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: `Search my Gmail for emails matching: "${query}". Return the subject, sender, date, and a snippet of the body for each result. Format as JSON array.` }],
        mcp_servers: [{
          type: "url",
          url: "https://gmailmcp.googleapis.com/mcp/v1",
          name: "gmail"
        }],
      }),
    });
    const data = await res.json();
    // Extract tool results
    const toolResults = (data.content || [])
      .filter(b => b.type === "mcp_tool_result")
      .map(b => b.content?.[0]?.text || "");
    const textResults = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text || "");
    return { toolResults, textResults, raw: data.content };
  } catch (e) {
    console.error("Gmail search error:", e);
    return null;
  }
}

// ─── Main Dashboard ─────────────────────────────────────────────────────
export default function LiveRFQDashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
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
  const [selectedExample, setSelectedExample] = useState('');

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
    localStorage.setItem('rfq-google-client-id', googleClientId || '');
    localStorage.setItem('rfq-ms-client-id', msClientId || '');
    localStorage.setItem('rfq-ms-tenant-id', msTenantId || '');
    localStorage.setItem('rfq-mail-provider', mailProvider || 'gmail');
  }, [provider, anthropicApiKey, anthropicModel, openaiApiKey, openaiBaseUrl, openaiModel, ollamaBaseUrl, ollamaModel, googleClientId, msClientId, msTenantId, mailProvider]);

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
  }), [provider, anthropicApiKey, anthropicModel, openaiApiKey, openaiBaseUrl, openaiModel, ollamaBaseUrl, ollamaModel]);

  const providerReady = (
    (provider === 'anthropic' && !!anthropicApiKey) ||
    (provider === 'openai' && !!openaiBaseUrl) ||
    (provider === 'ollama' && !!ollamaBaseUrl)
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
  const processedIdsRef = useRef(new Set());

  const addLog = useCallback((message, type = "info", detail = null) => {
    setLogs(prev => [{
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString("he-IL"),
      message,
      type,
      detail, // raw error object / API response — shown in verbose mode
    }, ...prev].slice(0, 200));
  }, []);

  // ─── Process a single email text with Claude ───────────────────────
  const processEmail = useCallback(async (emailText, emailId) => {
    if (processedIdsRef.current.has(emailId)) return null;
    processedIdsRef.current.add(emailId);

    // Extract sender address and subject for follow-up emails
    const fromMatch = emailText.match(
      /^From:\s*(?:[^<\n]*<)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?/im
    );
    const fromEmail = fromMatch ? fromMatch[1].trim() : null;
    const subjectMatch = emailText.match(/^Subject:\s*(.+)$/im);
    const originalSubject = subjectMatch ? subjectMatch[1].trim() : '';

    addLog(`🔄 מעבד מייל: ${emailId?.substring(0, 30)}...`, "info");
    setIsProcessing(true);

    try {
      const result = await callLLM(
        `Parse this RFQ email:\n\n${emailText}`,
        PARSE_PROMPT,
        llmConfig
      );

      if (!result || typeof result === 'object') {
        const err = result && result.error;
        const msg = err === 'missing_key'
          ? 'הזן API Key בהגדרות לפני עיבוד'
          : err === 'missing_base_url'
            ? 'חסר Base URL לספק OpenAI-compatible'
            : `שגיאה בעיבוד מייל: ${err || 'unknown'}`;
        addLog(`❌ ${msg}`, "error", result);
        setStats(p => ({ ...p, errors: p.errors + 1 }));
        setIsProcessing(false);
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (parseErr) {
        addLog(`⚠️ תוצאת AI לא תקינה — JSON parse נכשל`, "warning", { raw: result, error: parseErr?.message });
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
        acceptsAlternatives: part.acceptsAlternatives || "לא צוין",
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
        `✅ חולצו ${newRfqs.length} רכיבים${obsCount ? ` · ${obsCount} OBS` : ''} — ${parsed.summary || ""}`,
        "success"
      );

      // ── Auto follow-up when delivery date is missing ──────────────
      // Only fires for real inbox emails (not test/paste), and only when connected
      const isRealInbox = emailId?.startsWith('gmail-') || emailId?.startsWith('outlook-');
      const missingDate  = newRfqs.filter(r => !r.deliveryDate);
      if (isRealInbox && mailToken && fromEmail && missingDate.length > 0) {
        try {
          const partsList = missingDate
            .map(r => `<li><b>${r.partNumber}</b> — ${r.customerName}</li>`)
            .join('');
          const followSubject = originalSubject
            ? `Re: ${originalSubject} — נדרש תאריך אספקה`
            : 'נדרש תאריך אספקה לבקשת הצעת המחיר';
          const followBody = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:13px">
<p>שלום,</p>
<p>תודה על בקשת הצעת המחיר.</p>
<p>על מנת שנוכל לטפל בבקשה ביעילות, נבקש לקבל את <strong>תאריך האספקה הנדרש</strong> עבור הרכיבים הבאים:</p>
<ul>${partsList}</ul>
<p>האם תוכל/י לציין את המועד הנדרש?</p>
<p>תודה רבה,<br>צוות רכש — rfq Projects</p>
</div>`;
          if (mailProvider === 'gmail') {
            await gmailSendMessage(mailToken, fromEmail, followSubject, followBody);
          } else {
            const freshToken = await acquireOutlookToken(msClientId, msTenantId).catch(() => mailToken);
            await outlookSendMessage(freshToken, fromEmail, followSubject, followBody);
          }
          addLog(`📤 follow-up נשלח → ${fromEmail} (${missingDate.length} רכיב/ים ללא תאריך)`, "info");
        } catch (sendErr) {
          addLog(`⚠️ שליחת follow-up נכשלה: ${sendErr.message}`, "warning", sendErr);
        }
      }

      setIsProcessing(false);
      return newRfqs;
    } catch (e) {
      addLog(`❌ שגיאה: ${e.message}`, "error", e);
      setStats(p => ({ ...p, errors: p.errors + 1 }));
      setIsProcessing(false);
      return null;
    }
  }, [addLog, llmConfig, mailToken, mailProvider, msClientId, msTenantId]);

  // ─── Real mailbox handlers (Gmail / Outlook) ──────────────────────
  const connectMailbox = useCallback(async () => {
    try {
      setMailLoading(true);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      addLog(`🌐 Origin נוכחי: ${origin} (ודא שהוא רשום ב-OAuth client)`, "info");
      if (mailProvider === 'gmail') {
        if (!googleClientId) { addLog("❌ חסר Google Client ID בהגדרות", "error"); setMailLoading(false); return; }
        const token = await gmailSignIn(googleClientId);
        setMailToken(token);
        addLog("✅ מחובר ל-Gmail", "success");
      } else {
        if (!msClientId) { addLog("❌ חסר Microsoft Client ID בהגדרות", "error"); setMailLoading(false); return; }
        const token = await outlookSignIn(msClientId, msTenantId);
        setMailToken(token);
        addLog("✅ מחובר ל-Outlook", "success");
      }
    } catch (e) {
      const msg = e?.errorCode || e?.message || String(e);
      let hint = '';
      if (/popup_window_error|popup_window_blocked|blocked/i.test(msg)) hint = ' — הדפדפן חסם את ה-popup. אפשר popups לאתר זה בשורת הכתובת.';
      else if (/user_cancelled/i.test(msg)) hint = ' — המשתמש סגר את החלון.';
      else if (/AADSTS50194/i.test(msg)) hint = ' — האפליקציה single-tenant. מלא Tenant ID או הפוך ל-multi-tenant.';
      else if (/AADSTS|invalid_client|unauthorized_client/i.test(msg)) hint = ' — שגיאת הגדרת app ב-Entra (Client ID / Redirect URI / Scopes).';
      addLog(`❌ חיבור נכשל: ${msg}${hint}`, "error");
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
    addLog("🧹 מטמון MSAL נוקה — נסה להתחבר שוב", "info");
  }, [msClientId, msTenantId, addLog]);

  const refreshMailbox = useCallback(async () => {
    if (!mailToken) { addLog("⚠️ התחבר לתיבת דואר תחילה", "warning"); return; }
    setMailLoading(true);
    try {
      const list = mailProvider === 'gmail'
        ? await gmailListMessages(mailToken, mailSearch, 25)
        : await outlookListMessages(mailToken, mailSearch, 25);
      setMailMessages(list);
      addLog(`📬 נטענו ${list.length} מיילים מ-${mailProvider}`, "info");
    } catch (e) {
      addLog(`❌ טעינת רשימה נכשלה: ${e.message}`, "error");
    } finally {
      setMailLoading(false);
    }
  }, [mailProvider, mailToken, mailSearch, addLog]);

  const processMailMessage = useCallback(async (msg) => {
    if (!providerReady) { addLog("⚠️ הגדר ספק LLM בהגדרות תחילה", "warning"); return; }
    try {
      addLog(`🔍 טוען מייל: ${msg.subject}`, "info");
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
      addLog(`❌ עיבוד נכשל: ${e.message}`, "error");
    }
  }, [mailProvider, mailToken, msClientId, processEmail, providerReady, addLog]);

  const disconnectMailbox = useCallback(async () => {
    try {
      if (mailProvider === 'outlook' && msClientId) {
        await outlookSignOut(msClientId);
      }
    } catch {}
    setMailToken(null);
    setMailMessages([]);
    addLog(`🔌 נותק מ-${mailProvider}`, "info");
  }, [mailProvider, msClientId, addLog]);

  // ─── Load example .eml into the test textarea ─────────────────────
  const loadExample = useCallback(async (filename) => {
    if (!filename) return;
    try {
      addLog(`📥 טוען דוגמה: ${filename}`, "info");
      const res = await fetch(`/example-mails/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const parsed = parseEml(raw);
      setTestEmail(parsed.formatted);
      setActiveTab('test');
      addLog(`✅ נטען: ${parsed.subject || filename}`, "success");
    } catch (e) {
      addLog(`❌ טעינה נכשלה: ${e.message}`, "error");
    }
  }, [addLog]);

  // ─── Poll real mailbox (Gmail or Outlook) ─────────────────────────
  const pollGmail = useCallback(async () => {
    if (!mailToken) {
      addLog("⚠️ התחבר לתיבת דואר (Inbox) לפני הפעלת המערכת", "warning");
      return;
    }
    addLog(`📬 בודק ${mailProvider}...`, "info");
    setStats(p => ({ ...p, lastCheck: new Date().toLocaleTimeString("he-IL") }));
    try {
      const list = mailProvider === 'gmail'
        ? await gmailListMessages(mailToken, searchQuery, 10)
        : await outlookListMessages(mailToken, searchQuery, 10);
      const fresh = list.filter(m => !processedIdsRef.current.has(`${mailProvider}-${m.id}`));
      if (fresh.length === 0) { addLog("📭 אין מיילים חדשים", "info"); return; }
      addLog(`🆕 נמצאו ${fresh.length} מיילים חדשים`, "info");
      for (const msg of fresh) {
        await processMailMessage(msg);
      }
    } catch (e) {
      addLog(`❌ שגיאת תיבת דואר: ${e.message}`, "error");
    }
  }, [mailToken, mailProvider, searchQuery, addLog, processMailMessage]);

  // ─── Auto-poll loop ────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning && mailToken) {
      pollGmail();
      timerRef.current = setInterval(pollGmail, pollInterval * 1000);
      return () => clearInterval(timerRef.current);
    } else {
      clearInterval(timerRef.current);
    }
  }, [isRunning, mailToken, pollInterval, pollGmail]);

  // ─── Manual test processing ────────────────────────────────────────
  const handleTestProcess = useCallback(async () => {
    if (!testEmail.trim()) return;
    await processEmail(testEmail, `test-${Date.now()}`);
    setTestEmail("");
  }, [testEmail, processEmail]);

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
        ts: new Date().toLocaleTimeString("he-IL"),
      };
      return {
        ...r,
        status: prevStatus,
        statusHistory: [...(r.statusHistory || []), histEntry],
      };
    }));
    addLog(`◂ חזרה שלב — ${rfqId.slice(-8)}: "${comment}"`, "info");
    setBackModal(null);
    setBackComment('');
  }, [addLog]);

  // ─── Toggle human-in-loop flag ─────────────────────────────────────
  const toggleHumanLoop = useCallback((rfqId) => {
    setRfqs(prev => prev.map(r =>
      r.id === rfqId ? { ...r, humanLoop: !r.humanLoop } : r
    ));
  }, []);

  // ─── Build outgoing supplier email HTML ───────────────────────────
  const buildSupplierEmail = useCallback((rfq) => {
    const obsRow = rfq.isObsolete
      ? `<tr><th style="color:#e65100">Note</th><td style="color:#e65100"><b>OBSOLETE PART</b> — please confirm date code and country of origin</td></tr>`
      : '';
    const reqRow = rfq.specialRequirements
      ? `<tr><th>Special Requirements</th><td>${rfq.specialRequirements}</td></tr>`
      : '';
    return `<div dir="ltr" style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a2e">
<p>Dear Supplier,</p>
<p>We are requesting a quote for the following component on behalf of one of our customers:</p>
<table border="1" cellpadding="7" cellspacing="0" style="border-collapse:collapse;min-width:380px">
  <tr><th style="background:#f4f6fa;text-align:left;width:160px">Part Number</th><td><b style="font-family:monospace">${rfq.partNumber}</b></td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Quantity</th><td>${rfq.quantity?.toLocaleString()} pcs</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">End Customer</th><td>${rfq.customerName}</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Required Delivery</th><td>${rfq.deliveryDate || 'ASAP — please advise lead time'}</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Target Price</th><td>${rfq.targetPrice != null ? '$' + rfq.targetPrice + ' / unit' : 'Open — please quote best price'}</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Accepts Alternatives</th><td>${rfq.acceptsAlternatives}</td></tr>
  ${reqRow}${obsRow}
</table>
<p style="margin-top:14px">Please provide: <b>unit price</b>, <b>lead time</b>, <b>available quantity</b>, <b>MOQ</b>, and any relevant date code or condition information.</p>
<p>Best regards,<br><b>rfq Projects — Procurement Team</b></p>
</div>`;
  }, []);

  // ─── Send RFQ to all suppliers in the list ─────────────────────────
  const sendToSuppliers = useCallback(async (rfq) => {
    if (!mailToken) {
      addLog("⚠️ התחבר לתיבת דואר לפני שליחה לספקים", "warning");
      return;
    }
    if (!supplierList.length) {
      addLog("⚠️ הוסף ספקים ברשימה (הגדרות → רשימת ספקים)", "warning");
      return;
    }
    // Block if human-loop flag is set
    if (rfq.humanLoop) {
      addLog(`🔍 RFQ ${rfq.partNumber} מסומן לבדיקה ידנית — הסר את הדגל לפני שליחה`, "warning");
      return;
    }
    setSendingSuppliers(true);
    const subject = `RFQ — ${rfq.partNumber} | ${rfq.customerName}`;
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
        addLog(`📤 נשלח ל-${sup.name} <${sup.email}>`, "success");
        sent++;
      } catch (e) {
        addLog(`❌ שליחה ל-${sup.email} נכשלה: ${e.message}`, "error", e);
      }
    }
    if (sent > 0) {
      advanceStatus(rfq.id); // → distributed
      addLog(`✅ RFQ ${rfq.partNumber} הופץ ל-${sent}/${supplierList.length} ספקים`, "success");
    }
    setSendingSuppliers(false);
  }, [mailToken, mailProvider, msClientId, msTenantId, supplierList, addLog, buildSupplierEmail, advanceStatus]);

  // ─── Supplier list helpers ─────────────────────────────────────────
  const addSupplier = useCallback(() => {
    const name  = newSupplierName.trim();
    const email = newSupplierEmail.trim().toLowerCase();
    if (!name || !email || !email.includes('@')) return;
    if (supplierList.some(s => s.email === email)) {
      addLog(`⚠️ ${email} כבר קיים ברשימה`, "warning");
      return;
    }
    setSupplierList(prev => [...prev, { name, email }]);
    setNewSupplierName('');
    setNewSupplierEmail('');
    addLog(`➕ ספק נוסף: ${name} <${email}>`, "success");
  }, [newSupplierName, newSupplierEmail, supplierList, addLog]);

  const removeSupplier = useCallback((idx) => {
    setSupplierList(prev => {
      const removed = prev[idx];
      addLog(`🗑 ספק הוסר: ${removed?.name}`, "info");
      return prev.filter((_, i) => i !== idx);
    });
  }, [addLog]);

  // ─── Load a supplier-response .eml from public/supplier-mails/ ────
  const loadSupplierMail = useCallback(async (filename) => {
    if (!filename) return;
    try {
      addLog(`📥 טוען תגובת ספק: ${filename}`, "info");
      const res = await fetch(`/supplier-mails/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const parsed = parseEml(raw);
      setTestSupplierText(parsed.formatted);
      addLog(`✅ נטען: ${parsed.subject || filename}`, "success");
    } catch (e) {
      addLog(`❌ טעינת ספק נכשלה: ${e.message}`, "error", e);
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
        addLog(`❌ עיבוד תגובת ספק נכשל: ${result?.error || 'unknown'}`, "error", result);
        setTestSupplierProcessing(false);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (parseErr) {
        addLog(`⚠️ JSON לא תקין מתגובת ספק`, "warning", { raw: result, error: parseErr?.message });
        setTestSupplierProcessing(false);
        return;
      }

      // Score against linked RFQ (if selected)
      const linkedRfq = rfqs.find(r => r.id === testSupplierLinkRfqId) || null;
      const score = scoreSupplierResponse(parsed, linkedRfq);

      const entry = {
        ...parsed,
        score,
        rfqId:      testSupplierLinkRfqId || null,
        receivedAt: new Date().toLocaleTimeString("he-IL"),
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
        addLog(`📊 תגובת ספק קושרה ל-${linkedRfq?.partNumber || testSupplierLinkRfqId} — ניקוד: ${score}`, "success");
      } else {
        addLog(`📊 תגובת ספק עובדה — ניקוד: ${score}`, "success");
      }
    } catch (e) {
      addLog(`❌ שגיאה בעיבוד תגובת ספק: ${e.message}`, "error", e);
    }

    setTestSupplierProcessing(false);
  }, [testSupplierText, testSupplierLinkRfqId, rfqs, llmConfig, addLog]);

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
      direction: "rtl",
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
          }}>N</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
              rfq <span style={{ color: "var(--accent)" }}>RFQ</span> LIVE
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
              בדיקה אחרונה: {stats.lastCheck}
            </span>
          )}

          {/* Provider badge */}
          <button
            onClick={() => setActiveTab('config')}
            title="שנה ספק LLM בהגדרות"
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
            title={theme === 'dark' ? 'מצב בהיר' : 'מצב כהה'}
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
                { label: "סה״כ RFQs",  value: rfqs.length,               color: "var(--accent)", icon: <InboxIcon   size={16} color="var(--accent)" /> },
                { label: "עובדו",       value: stats.processed,            color: "var(--green)",  icon: <CheckIcon   size={16} color="var(--green)" /> },
                { label: "ממתינים",     value: statusCounts.awaiting || 0, color: "var(--amber)",  icon: <ClockIcon   size={16} color="var(--amber)" /> },
                { label: "שגיאות",      value: stats.errors,               color: "var(--red)",    icon: <AlertIcon   size={16} color="var(--red)" /> },
                { label: "הושלמו",      value: statusCounts.completed || 0,color: "var(--green)",  icon: <CheckIcon   size={16} color="var(--green)" /> },
                { label: "אובסולייט",   value: rfqs.filter(r=>r.isObsolete).length, color: "#FB923C", icon: <AlertIcon size={16} color="#FB923C" /> },
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
                    <div style={{ fontSize: 8, color: "var(--text3)" }}>{st.labelEn}</div>
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
                    title="בחר/בטל הכל"
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
                        if (window.confirm(`מחק את כל ${rfqs.length} הרכיבים מהרשימה?`)) {
                          setRfqs([]);
                          setCheckedRfqIds({});
                          setSelectedRfq(null);
                          addLog("🗑 רשימת RFQ נוקתה", "info");
                        }
                      }}
                      title="מחק את כל הרכיבים מהרשימה"
                      style={{
                        padding: "3px 8px", borderRadius: 6, fontSize: 9, fontWeight: 600,
                        cursor: "pointer", border: "1px solid var(--border)",
                        background: "var(--surface2)", color: "var(--text3)",
                        transition: "all 0.15s",
                      }}
                    >🗑 נקה הכל</button>
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
                    title="סנן לפי סטטוס"
                    style={{
                      padding: "5px 10px", borderRadius: 8,
                      background: filterStatus ? "var(--surface3)" : "var(--surface2)",
                      border: filterStatus ? "1px solid var(--accent)" : "1px solid var(--border)",
                      color: filterStatus ? "var(--accent)" : "var(--text3)",
                      fontSize: 10, outline: "none", cursor: "pointer",
                      fontWeight: filterStatus ? 700 : 400,
                    }}
                  >
                    <option value="">כל הסטטוסים</option>
                    {Object.entries(STATUS).map(([key, { label, color }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  {/* Clear filters button — shown when any filter active */}
                  {(filterStatus || filterText || showObsoleteOnly) && (
                    <button
                      onClick={() => { setFilterStatus(''); setFilterText(''); setShowObsoleteOnly(false); }}
                      title="נקה כל הסינונים"
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
                      placeholder="חיפוש..."
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
                    {Object.keys(checkedRfqIds).length} נבחרו
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
                  >✕ בטל</button>
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
                <div>שם לקוח</div>
                <div>מק״ט יצרן</div>
                <div>כמות</div>
                <div>ת. אספקה</div>
                <div>תחליפי?</div>
                <div>מחיר מטרה</div>
                <div>דרישות מיוחדות</div>
                <div>סטטוס</div>
                <div></div>{/* actions */}
              </div>

              {/* Table body */}
              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {filteredRfqs.length === 0 ? (
                  <div style={{
                    padding: "60px 20px", textAlign: "center", color: "var(--text3)",
                  }}>
                    <InboxIcon size={32} color="var(--text3)" style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
                    <div style={{ fontSize: 13, marginBottom: 6 }}>אין בקשות עדיין</div>
                    <div style={{ fontSize: 11 }}>חבר Gmail והפעל את המערכת, או הדבק מייל בלשונית Test</div>
                  </div>
                ) : filteredRfqs.map((rfq, i) => {
                  const st = STATUS[rfq.status] || STATUS.new;
                  const isSelected = selectedRfq?.id === rfq.id;
                  const isChecked  = !!checkedRfqIds[rfq.id];
                  return (
                    <div
                      key={rfq.id}
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
                          <div title="ממתין לאישור ידני" style={{ fontSize: 8, lineHeight: 1 }}>🔍</div>
                        )}
                      </div>
                      {/* 1. שם לקוח */}
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{rfq.customerName}</div>
                      {/* 2. מק״ט יצרן + OBS badge */}
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
                      {/* 3. כמות */}
                      <div style={{ fontSize: 11, fontWeight: 500, direction: "ltr", textAlign: "left" }}>
                        {rfq.quantity?.toLocaleString()}
                      </div>
                      {/* 4. ת. אספקה */}
                      <div style={{ fontSize: 10, color: rfq.deliveryDate ? "var(--text2)" : "var(--red)" }}>
                        {rfq.deliveryDate || "⚠ חסר"}
                      </div>
                      {/* 5. תחליפי */}
                      <div>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                          background: rfq.acceptsAlternatives === "כן" ? "#34D39915" : rfq.acceptsAlternatives === "לא" ? "#F8717115" : "var(--surface2)",
                          color: rfq.acceptsAlternatives === "כן" ? "var(--green)" : rfq.acceptsAlternatives === "לא" ? "var(--red)" : "var(--text3)",
                          border: `1px solid ${rfq.acceptsAlternatives === "כן" ? "#34D39925" : rfq.acceptsAlternatives === "לא" ? "#F8717125" : "var(--border)"}`,
                        }}>{rfq.acceptsAlternatives}</span>
                      </div>
                      {/* 6. מחיר מטרה */}
                      <div style={{ fontSize: 11, direction: "ltr", textAlign: "left", color: rfq.targetPrice != null ? "var(--text)" : "var(--text3)" }}>
                        {rfq.targetPrice != null ? `$${rfq.targetPrice}` : "—"}
                      </div>
                      {/* 7. דרישות מיוחדות */}
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
                            title="חזרה שלב (נדרשת סיבה)"
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
                            title="קדם שלב"
                            onClick={() => advanceStatus(rfq.id)}
                            style={{
                              background: "var(--surface2)", border: "1px solid var(--border)",
                              borderRadius: 6, padding: "3px 6px", cursor: "pointer",
                              fontSize: 10, color: "var(--accent)",
                            }}
                          >▸</button>
                        )}
                        <button
                          title="מחק רכיב זה מהרשימה"
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
                  );
                })}
              </div>
            </div>

            {/* Selected RFQ detail */}
            {selectedRfq && (() => {
              const sr = rfqs.find(r => r.id === selectedRfq.id) || selectedRfq;
              const responses = sr.supplierResponses || [];
              const bestScore = responses.length ? Math.max(...responses.map(r => r.score ?? 0)) : null;
              const scoreColor = (s) => s >= 70 ? "var(--green)" : s >= 40 ? "var(--amber)" : "var(--red)";
              return (
              <div style={{
                background: "var(--surface)",
                border: `1px solid ${sr.isObsolete ? "#FB923C40" : "var(--accent)30"}`,
                borderRadius: 12, padding: 20, marginTop: 16,
                animation: "slideIn 0.2s ease",
              }}>
                {/* ── Header row ── */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>
                      {sr.id} · {sr.sender}
                      {sr.fromEmail && <span style={{ color: "var(--text3)" }}> · {sr.fromEmail}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 700, direction: "ltr", color: "var(--accent)" }}>
                        {sr.partNumber}
                      </span>
                      {sr.isObsolete && (
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
                          background: "#FB923C25", color: "#FB923C", border: "1px solid #FB923C50",
                        }}>OBSOLETE</span>
                      )}
                      {sr.humanLoop && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                          background: "#38BDF820", color: "var(--accent)", border: "1px solid #38BDF840",
                        }}>🔍 HUMAN REVIEW</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setSelectedRfq(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                    <XIcon size={16} color="var(--text3)" />
                  </button>
                </div>

                {/* ── 8 fields grid ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
                  {[
                    { l: "1. שם לקוח",      v: sr.customerName,             c: "var(--text)" },
                    { l: "2. מק״ט יצרן",    v: sr.partNumber,               c: "var(--accent)", ltr: true },
                    { l: "3. כמות",          v: sr.quantity?.toLocaleString(),c: "var(--text)" },
                    { l: "4. תאריך אספקה",  v: sr.deliveryDate || "⚠ לא צוין",
                                             c: sr.deliveryDate ? "var(--text)" : "var(--red)" },
                  ].map((f, i) => (
                    <div key={i} style={{ background: "var(--surface2)", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 4, fontWeight: 600 }}>{f.l}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: f.c, direction: f.ltr ? "ltr" : "rtl", textAlign: f.ltr ? "left" : "right" }}>{f.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
                  <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 4, fontWeight: 600 }}>5. מוכן לתחליפי?</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: sr.acceptsAlternatives === "כן" ? "var(--green)" : sr.acceptsAlternatives === "לא" ? "var(--red)" : "var(--text3)" }}>
                      {sr.acceptsAlternatives === "כן" ? "✓ כן" : sr.acceptsAlternatives === "לא" ? "✗ לא" : "— לא צוין"}
                    </div>
                  </div>
                  <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 4, fontWeight: 600 }}>6. מחיר מטרה</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: sr.targetPrice != null ? "var(--green)" : "var(--text3)", direction: "ltr", textAlign: "left" }}>
                      {sr.targetPrice != null ? `$${sr.targetPrice}` : "לא צוין"}
                    </div>
                  </div>
                  <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 4, fontWeight: 600 }}>עדיפות</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: sr.priority === "high" ? "var(--red)" : sr.priority === "medium" ? "var(--amber)" : "var(--green)" }}>
                      {sr.priority === "high" ? "🔴 גבוה" : sr.priority === "medium" ? "🟡 בינוני" : "🟢 נמוך"}
                    </div>
                  </div>
                </div>

                {/* ── 7. דרישות מיוחדות ── */}
                {sr.specialRequirements && (
                  <div style={{
                    background: "#FBBF2408", borderRadius: 8, padding: "12px 16px",
                    fontSize: 12, color: "var(--amber)", borderRight: "3px solid var(--amber)", marginBottom: 12,
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text3)", display: "block", marginBottom: 4 }}>7. דרישות מיוחדות</span>
                    {sr.specialRequirements}
                  </div>
                )}

                {sr.summary && (
                  <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic", paddingBottom: 12 }}>
                    סיכום AI: {sr.summary}
                  </div>
                )}

                {/* ── Supplier responses table ── */}
                {responses.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>
                      📊 תגובות ספקים ({responses.length}) · הטוב ביותר: <span style={{ color: scoreColor(bestScore) }}>{bestScore}/100</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, direction: "ltr" }}>
                        <thead>
                          <tr style={{ background: "var(--surface2)", color: "var(--text3)", fontSize: 9, textTransform: "uppercase" }}>
                            {["ספק","מחיר יחידה","המל״ז (ימים)","זמינות","MOQ","ציון","הערות"].map(h => (
                              <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {responses.map((resp, ri) => {
                            const isBest = resp.score === bestScore && bestScore != null;
                            return (
                              <tr key={ri} style={{
                                background: isBest ? "#34D39910" : "transparent",
                                borderBottom: "1px solid var(--border)",
                                borderRight: isBest ? "3px solid var(--green)" : "none",
                              }}>
                                <td style={{ padding: "6px 10px", fontWeight: 600, color: "var(--text)" }}>
                                  {isBest && <span style={{ color: "var(--green)", marginLeft: 4 }}>★</span>}
                                  {resp.supplierName || "—"}
                                </td>
                                <td style={{ padding: "6px 10px", color: resp.quotedPrice != null ? "var(--green)" : "var(--text3)" }}>
                                  {resp.quotedPrice != null ? `$${resp.quotedPrice}` : "—"}
                                  {resp.currency && resp.currency !== "USD" && <span style={{ fontSize: 8, color: "var(--text3)", marginLeft: 3 }}>{resp.currency}</span>}
                                </td>
                                <td style={{ padding: "6px 10px", color: resp.leadTimeDays === 0 ? "var(--green)" : "var(--text2)" }}>
                                  {resp.leadTimeDays === 0 ? "In Stock" : resp.leadTimeDays != null ? `${resp.leadTimeDays}d` : "—"}
                                </td>
                                <td style={{ padding: "6px 10px", color: "var(--text2)" }}>
                                  {resp.availableQty != null ? resp.availableQty.toLocaleString() : resp.inStock ? "✓ Stock" : "—"}
                                </td>
                                <td style={{ padding: "6px 10px", color: "var(--text3)" }}>
                                  {resp.moq != null ? resp.moq.toLocaleString() : "—"}
                                </td>
                                <td style={{ padding: "6px 10px" }}>
                                  <span style={{
                                    fontWeight: 700, color: scoreColor(resp.score ?? 0),
                                    background: `${scoreColor(resp.score ?? 0)}15`,
                                    padding: "2px 8px", borderRadius: 4,
                                  }}>{resp.score ?? "—"}</span>
                                </td>
                                <td style={{ padding: "6px 10px", fontSize: 9, color: "var(--text3)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {resp.notes || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Status history ── */}
                {(sr.statusHistory || []).length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      היסטוריית שלבים
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {sr.statusHistory.map((h, hi) => (
                        <div key={hi} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          fontSize: 10, color: "var(--text2)",
                          background: "var(--surface2)", borderRadius: 6, padding: "6px 10px",
                        }}>
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

                {/* ── Action buttons ── */}
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sr.status !== 'completed' && (
                    <button
                      onClick={() => advanceStatus(sr.id)}
                      style={{
                        padding: "9px 20px", borderRadius: 8,
                        background: "var(--accent)", color: "#000",
                        border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                      }}
                    >קדם שלב ▸</button>
                  )}
                  {sr.status !== 'new' && (
                    <button
                      onClick={() => { setBackModal({ rfqId: sr.id }); setBackComment(''); }}
                      style={{
                        padding: "9px 16px", borderRadius: 8,
                        background: "var(--surface2)", color: "var(--text2)",
                        border: "1px solid var(--border)", cursor: "pointer", fontSize: 11,
                      }}
                    >◂ חזרה</button>
                  )}
                  {/* Send to suppliers */}
                  <button
                    onClick={() => sendToSuppliers(sr)}
                    disabled={sendingSuppliers || !mailToken || !supplierList.length}
                    title={!mailToken ? "התחבר לתיבת דואר תחילה" : !supplierList.length ? "הוסף ספקים בהגדרות" : sr.humanLoop ? "הסר דגל בדיקה ידנית לפני שליחה" : "שלח לכל הספקים ברשימה"}
                    style={{
                      padding: "9px 18px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                      display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                      background: (sendingSuppliers || !mailToken || !supplierList.length)
                        ? "var(--surface3)" : sr.humanLoop ? "#FBBF2420" : "#F472B620",
                      color: (sendingSuppliers || !mailToken || !supplierList.length)
                        ? "var(--text3)" : sr.humanLoop ? "var(--amber)" : "var(--pink)",
                      border: `1px solid ${sr.humanLoop ? "#FBBF2440" : "#F472B640"}`,
                    }}
                  >
                    <SendIcon size={12} />
                    {sendingSuppliers ? "שולח..." : `שלח לספקים (${supplierList.length})`}
                  </button>
                  {/* Human-loop toggle */}
                  <button
                    onClick={() => toggleHumanLoop(sr.id)}
                    title={sr.humanLoop ? "הסר דגל — אפשר שליחה אוטומטית" : "סמן לבדיקה ידנית לפני שליחה"}
                    style={{
                      padding: "9px 14px", borderRadius: 8, fontSize: 11,
                      cursor: "pointer",
                      background: sr.humanLoop ? "#38BDF820" : "var(--surface2)",
                      color: sr.humanLoop ? "var(--accent)" : "var(--text3)",
                      border: `1px solid ${sr.humanLoop ? "#38BDF840" : "var(--border)"}`,
                    }}
                  >{sr.humanLoop ? "🔍 הסר בדיקה" : "🔍 סמן לבדיקה"}</button>
                  {/* Copy */}
                  <button
                    onClick={() => {
                      const text = `שם לקוח: ${sr.customerName}\nמק״ט: ${sr.partNumber}\nכמות: ${sr.quantity}\nת. אספקה: ${sr.deliveryDate || "—"}\nתחליפי: ${sr.acceptsAlternatives}\nמחיר מטרה: ${sr.targetPrice != null ? "$" + sr.targetPrice : "—"}\nדרישות: ${sr.specialRequirements || "—"}\nOBS: ${sr.isObsolete ? "כן" : "לא"}`;
                      navigator.clipboard?.writeText(text);
                      addLog("📋 נתוני RFQ הועתקו ללוח", "success");
                    }}
                    style={{
                      padding: "9px 16px", borderRadius: 8,
                      background: "var(--surface2)", color: "var(--text2)",
                      border: "1px solid var(--border)", cursor: "pointer", fontSize: 11,
                    }}
                  >📋 העתק</button>
                </div>
              </div>
              );
            })()}
          </div>
        )}

        {/* ━━━ INBOX TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "inbox" && (
          <div style={{ animation: "slideIn 0.3s ease" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--accent)" }}>
              📬 תיבת דואר אמיתית
            </h2>
            <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 20 }}>
              התחבר ל-Gmail או Outlook, סנן, ובחר מייל להזרמה דרך מנוע ה-LLM.
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
                    {mailLoading ? "מתחבר..." : `🔑 התחבר ל-${mailProvider === 'gmail' ? 'Gmail' : 'Outlook'}`}
                  </button>
                  {mailProvider === 'outlook' && (
                    <button
                      onClick={resetOutlookCache}
                      title="נקה את מטמון MSAL — נסה אם ה-popup לא נפתח"
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: "var(--surface2)", color: "var(--text2)",
                        border: "1px solid var(--border)", cursor: "pointer",
                        fontSize: 10, fontWeight: 600,
                      }}
                    >
                      🧹 נקה MSAL
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
                  🔌 התנתק
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
                {mailLoading ? "..." : "🔄 טען רשימה"}
              </button>
            </div>

            {/* Message list */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {mailMessages.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  {mailToken ? "אין הודעות — נסה שאילתה אחרת" : "לא מחובר לתיבת דואר"}
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
                        {m.from} · {m.date && new Date(m.date).toLocaleString("he-IL")}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.snippet}
                      </div>
                    </div>
                    <button
                      onClick={() => processMailMessage(m)}
                      disabled={isProcessing || !providerReady}
                      title={!providerReady ? "הגדר ספק LLM תחילה" : "עבד דרך ה-LLM"}
                      style={{
                        padding: "8px 14px", borderRadius: 8,
                        background: (!providerReady || isProcessing) ? "var(--surface3)" : "var(--amber)",
                        color: (!providerReady || isProcessing) ? "var(--text3)" : "#000",
                        border: "none", cursor: (!providerReady || isProcessing) ? "default" : "pointer",
                        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                      }}
                    >
                      ▶ עבד
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
              ⚙️ הגדרות מערכת
            </h2>

            {/* LLM Provider */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                🤖 ספק מנוע LLM
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
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Anthropic API Key (נשמר ב-localStorage בדפדפן בלבד)</div>
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
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Base URL (תואם OpenAI — OpenAI / Groq / Together / LM Studio וכו׳)</div>
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
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Ollama Base URL (מקומי ברירת מחדל)</div>
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
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>Model (ודא ש־ollama pull רץ למודל זה)</div>
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
                    ⚠️ אם הדפדפן חוסם CORS, הפעל Ollama עם: <code style={{fontFamily:"monospace"}}>$env:OLLAMA_ORIGINS="*"; ollama serve</code>
                  </div>
                </div>
              )}

              <div style={{ fontSize: 10, color: providerReady ? "var(--green)" : "var(--text3)", marginTop: 12 }}>
                {providerReady ? `✓ ספק ${provider} מוכן` : "⚠ ההגדרה עדיין לא שלמה"}
              </div>
            </div>

            {/* Mailbox OAuth Client IDs */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                📬 תיבות דואר אמיתיות (OAuth)
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 14, lineHeight: 1.7 }}>
                הוסף Client IDs כדי להתחבר לתיבות ה-Gmail וה-Outlook שלך. כל ה-OAuth מתבצע בדפדפן — לא נשמרים tokens בשרת.
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
                  צור ב-<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Google Cloud Console</a> → OAuth 2.0 Client ID (Web).
                  הוסף ל-Authorized JavaScript origins: <code style={{ direction: "ltr", fontFamily: "monospace" }}>{typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"}</code>.
                  הפעל Gmail API בפרויקט.
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
                <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 4 }}>Microsoft Tenant ID (או domain — דרוש אם האפליקציה היא single-tenant)</div>
                <input
                  value={msTenantId}
                  onChange={e => setMsTenantId(e.target.value)}
                  placeholder="contoso.onmicrosoft.com או GUID — השאר ריק ל-multi-tenant"
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 12, outline: "none",
                    direction: "ltr", fontFamily: "monospace",
                  }}
                />
                <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
                  צור ב-<a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Microsoft Entra</a> → App registrations → Single-page application.
                  Redirect URI: <code style={{ direction: "ltr", fontFamily: "monospace" }}>{typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"}</code>.
                  הרשאות Microsoft Graph: <code>Mail.Read</code>, <code>User.Read</code> (delegated).
                  את ה-Tenant ID תמצא ב-Overview של ה-app registration (Directory (tenant) ID).
                </div>
              </div>
            </div>

            {/* Info: real mailbox connection happens in Inbox tab */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 16, marginBottom: 16,
              fontSize: 11, color: "var(--text2)", lineHeight: 1.7,
            }}>
              💡 לחיבור אמיתי ל-Gmail / Outlook, עבור ל-<button onClick={() => setActiveTab('inbox')} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit", textDecoration: "underline" }}>טאב Inbox</button>. מצב החיבור הנוכחי: {mailToken ? <span style={{ color: "var(--green)" }}>✓ מחובר ({mailProvider})</span> : <span style={{ color: "var(--red)" }}>לא מחובר</span>}
            </div>

            {/* Search Query */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                🔍 שאילתת חיפוש Gmail
              </div>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 12 }}>
                Gmail search query — שנה לפי הצורך
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
                ⏱️ תדירות בדיקה
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
                <div style={{ fontSize: 13, fontWeight: 600 }}>רשימת ספקים</div>
                {supplierList.length > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 10,
                    background: "#F472B620", color: "var(--pink)", border: "1px solid #F472B640",
                  }}>{supplierList.length}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6 }}>
                כתובות הדוא״ל שאליהן ישלחו בקשות הצעת המחיר. השליחה מתבצעת דרך תיבת הדואר המחוברת.
              </div>

              {/* Existing suppliers */}
              {supplierList.length === 0 ? (
                <div style={{
                  padding: "16px 0", textAlign: "center", color: "var(--text3)", fontSize: 11,
                  borderBottom: "1px solid var(--border)", marginBottom: 14,
                }}>
                  אין ספקים ברשימה עדיין — הוסף למטה
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
                        title="הסר ספק"
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
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>שם ספק</div>
                  <input
                    value={newSupplierName}
                    onChange={e => setNewSupplierName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSupplier()}
                    placeholder="לדוגמה: Arrow Electronics"
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 12, outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1.2 }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>כתובת דוא״ל</div>
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
                >+ הוסף</button>
              </div>
            </div>

            {/* Start/Stop */}
            <div style={{
              background: "var(--surface)", border: `1px solid ${isRunning ? "var(--green)30" : "var(--border)"}`,
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                🚀 הפעלת מערכת
              </div>
              <button
                onClick={() => {
                  if (!mailToken) {
                    addLog("⚠️ התחבר לתיבת דואר (Inbox) לפני הפעלה", "warning");
                    setActiveTab('inbox');
                    return;
                  }
                  if (!providerReady) {
                    addLog("⚠️ הגדר ספק LLM לפני הפעלה", "warning");
                    return;
                  }
                  setIsRunning(!isRunning);
                  addLog(isRunning ? "⏹️ מערכת הופסקה" : `▶️ מערכת הופעלה — בודק כל ${pollInterval} שניות`, "info");
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
                {isRunning ? <><PauseIcon size={16} color="#fff" /> עצור מערכת</> : <><PlayIcon size={16} color="#fff" /> הפעל מערכת</>}
              </button>
            </div>
          </div>
        )}

        {/* ━━━ TEST TAB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {activeTab === "test" && (
          <div style={{ animation: "slideIn 0.3s ease", maxWidth: 800 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--amber)" }}>
              ⚡ בדיקה ידנית
            </h2>
            <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 20 }}>
              הדבק תוכן של מייל RFQ כדי לבדוק את מנוע העיבוד — Claude AI יחלץ את הנתונים אוטומטית.
            </p>

            {/* Example email picker */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 16, marginBottom: 16,
              display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>
                📁 טען מייל לדוגמה:
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
                <option value="">— בחר מייל לטעינה —</option>
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
                title={!providerReady ? "הגדר את ספק ה-LLM תחילה בהגדרות" : `טען והרץ דרך ${provider}`}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  background: (!selectedExample || !providerReady) ? "var(--surface3)" : "var(--amber)",
                  color: (!selectedExample || !providerReady) ? "var(--text3)" : "#000",
                  border: "none", cursor: (!selectedExample || !providerReady) ? "default" : "pointer",
                  fontSize: 11, fontWeight: 700,
                }}
              >
                ▶ טען והרץ
              </button>
            </div>

            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 20,
            }}>
              <textarea
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder={`הדבק כאן תוכן מייל RFQ לבדיקה...

לדוגמה:
היי לקוח
דרישה לרכש
כמות – 10000 יח
רכיב: TPS61045DRBR
יצרן: Texas Instruments
לקוח: Acme Corp
אין מחיר קניה / מטרה
תודה`}
                style={{
                  width: "100%", minHeight: 200, padding: 16, borderRadius: 10,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 12, resize: "vertical",
                  outline: "none", lineHeight: 1.7,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                <span style={{ fontSize: 10, color: "var(--text3)" }}>
                  {testEmail.length > 0 ? `${testEmail.length} תווים` : ""}
                </span>
                <button
                  onClick={handleTestProcess}
                  disabled={isProcessing || !testEmail.trim()}
                  style={{
                    padding: "10px 24px", borderRadius: 10,
                    background: isProcessing ? "var(--surface3)" : "var(--amber)",
                    color: isProcessing ? "var(--text3)" : "#000",
                    border: "none", cursor: isProcessing ? "default" : "pointer",
                    fontSize: 12, fontWeight: 700,
                    display: "flex", alignItems: "center", gap: 8,
                    opacity: !testEmail.trim() ? 0.4 : 1,
                  }}
                >
                  {isProcessing ? (
                    <>
                      <RefreshIcon size={14} style={{ animation: "spin 1s linear infinite" }} />
                      מעבד...
                    </>
                  ) : (
                    <>
                      <ZapIcon size={14} color="#000" />
                      עבד עם Claude AI
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick test templates */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 10 }}>
                תבניות בדיקה מהירות:
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "TPS61045DRBR (Acme Corp)", text: "היי\n\nדרישה לכמות – 10000 י\"ח\nאין מחיר קניה / מטרה\nלבדיקתך ועדכונך\nלקוח: Acme Corp\nנדרש עד 15/06/2026\nלא מוכנים לתחליפי\n\nתודה\n\nTPS61045DRBR\nTexas Instruments" },
                  { label: "IRFS4610 (Obsolete)", text: "בוקר טוב\n\nרכיב אובסולייט – מיועד לרכש\nכמות – 21600 י\"ח\nמחיר קניה אחרון – 0.78$\nלקוח: HP\nאספקה נדרשת: Q2 2026\nמוכנים לשקול חלופות\nדרישה מיוחדת: תאריך ייצור לא יותר מ-2 שנים\n\nתודה\n\nIRFS4610TRLPBF\nInfineon" },
                  { label: "Micron SSD (Globex Ltd)", text: "היי\n\nדרישה לרכש\nכמות – 300 י\"ח\nמחיר קניה – 33$\nלקוח: Globex Ltd (Team)\nנדרש דוח מעבדת – GETS\nאספקה: מיידית\nלא מוכנים לתחליפי – מוצר צבאי\n\nMTFDHBL064TDQ-1AT12ATYY\nMicron\n\nתודה" },
                  { label: "Multi-part (Acme Corp/KLA)", text: "היי לקוח\n\nמיועד לרכש\nלבדיקתך ועדכונך\n\nשם לקוח: Acme Corp BE LTD\nתאריך נדרש: 05/04/2026\nמק\"ט ספק: UCC28089D\nכמות: 225\nמחיר מטרה: 1.200$\nדרישות: אין\n\nשם לקוח: Contoso Semi\nתאריך נדרש: 05/04/2026\nמק\"ט ספק: AD8512ARZ-REEL\nכמות: 98\nמחיר מטרה: 3.980$\nמוכנים לתחליפי: כן\n\nשם לקוח: Wayne Optics Ltd LTD\nתאריך נדרש: 05/07/2026\nמק\"ט ספק: THS4504DGN\nכמות: 80\nמחיר מטרה: 4.398$\nדרישות: ROHS compliance\n\nתודה" },
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
                  תצוגה מקדימה — שליחה לספקים
                </h3>
              </div>

              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: 18,
              }}>
                {/* RFQ selector */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "var(--text2)", fontWeight: 600, minWidth: 90 }}>בחר RFQ:</label>
                  <select
                    value={testOutreachRfqId}
                    onChange={e => setTestOutreachRfqId(e.target.value)}
                    style={{
                      flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 8,
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text)", fontSize: 11, outline: "none",
                    }}
                  >
                    <option value="">— בחר RFQ לתצוגה —</option>
                    {rfqs.filter(r => r.partNumber).map(r => (
                      <option key={r.id} value={r.id}>
                        {r.partNumber} — {r.customerName}{r.isObsolete ? " [OBS]" : ""}
                      </option>
                    ))}
                  </select>

                  {/* Human-loop toggle for selected RFQ */}
                  {testOutreachRfqId && (() => {
                    const selRfq = rfqs.find(r => r.id === testOutreachRfqId);
                    if (!selRfq) return null;
                    return (
                      <button
                        onClick={() => toggleHumanLoop(testOutreachRfqId)}
                        title={selRfq.humanLoop ? "לחץ להסרת דגל — תאפשר שליחה אוטומטית" : "לחץ לסימון לבדיקה ידנית לפני שליחה"}
                        style={{
                          padding: "7px 14px", borderRadius: 8,
                          background: selRfq.humanLoop ? "#FBBF2420" : "var(--surface2)",
                          color: selRfq.humanLoop ? "var(--amber)" : "var(--text3)",
                          border: `1px solid ${selRfq.humanLoop ? "#FBBF2460" : "var(--border)"}`,
                          cursor: "pointer", fontSize: 11, fontWeight: 700,
                          display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        🔍 {selRfq.humanLoop ? "בדיקה ידנית ON" : "בדיקה ידנית OFF"}
                      </button>
                    );
                  })()}

                  {/* Send button */}
                  {testOutreachRfqId && (() => {
                    const selRfq = rfqs.find(r => r.id === testOutreachRfqId);
                    if (!selRfq) return null;
                    const canSend = mailToken && supplierList.length > 0 && !selRfq.humanLoop && !sendingSuppliers;
                    const tooltip = !mailToken ? "התחבר לתיבת דואר תחילה"
                      : !supplierList.length ? "הוסף ספקים בהגדרות"
                      : selRfq.humanLoop ? "הסר דגל בדיקה ידנית לפני שליחה"
                      : `שלח ל-${supplierList.length} ספקים`;
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
                        📤 {sendingSuppliers ? "שולח..." : `שלח ל-${supplierList.length} ספקים`}
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
                      <span>נושא: <b style={{ color: "var(--text)" }}>RFQ — {rfqs.find(r => r.id === testOutreachRfqId)?.partNumber} | {rfqs.find(r => r.id === testOutreachRfqId)?.customerName}</b></span>
                      <span style={{ marginRight: "auto" }}>
                        {supplierList.length > 0
                          ? `יישלח ל: ${supplierList.map(s => s.email).join(", ")}`
                          : "⚠ אין ספקים ברשימה"}
                      </span>
                    </div>
                    <div
                      style={{ padding: 16, fontSize: 13, maxHeight: 340, overflowY: "auto" }}
                      dangerouslySetInnerHTML={{ __html: buildSupplierEmail(rfqs.find(r => r.id === testOutreachRfqId)) }}
                    />
                  </div>
                ) : (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text3)", fontSize: 11 }}>
                    בחר RFQ מהרשימה למעלה לתצוגה מקדימה של המייל
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
                  עיבוד תגובת ספק — חישוב ניקוד
                </h3>
              </div>

              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: 18,
              }}>
                {/* Supplier .eml file picker + link to RFQ */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
                    <label style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600 }}>טען .eml לדוגמה:</label>
                    <select
                      value={testSupplierFile}
                      onChange={e => { setTestSupplierFile(e.target.value); loadSupplierMail(e.target.value); }}
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 11, outline: "none",
                      }}
                    >
                      <option value="">— בחר קובץ .eml —</option>
                      {SUPPLIER_MAIL_FILES.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
                    <label style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600 }}>קשר ל-RFQ (לחישוב ניקוד):</label>
                    <select
                      value={testSupplierLinkRfqId}
                      onChange={e => setTestSupplierLinkRfqId(e.target.value)}
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 11, outline: "none",
                      }}
                    >
                      <option value="">— ללא קישור —</option>
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
                  placeholder={`הדבק כאן תגובת מייל מספק לניתוח...

לדוגמה:
Dear rfq,
Thank you for your inquiry.
We can offer the following:
Part: TPS61045DRBR
Price: $0.85/unit
MOQ: 1000 pcs
Lead time: 4-6 weeks
Available qty: 25,000

Best regards,
ABC Electronics`}
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
                    title={!providerReady ? "הגדר ספק LLM בהגדרות תחילה" : ""}
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
                        מעבד...
                      </>
                    ) : (
                      <>📊 עבד תגובה</>
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
                          {testSupplierResult.supplierName || "ספק לא זוהה"}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                          {testSupplierResult.rfqId
                            ? `קשור ל-${rfqs.find(r => r.id === testSupplierResult.rfqId)?.partNumber || testSupplierResult.rfqId}`
                            : "לא קשור ל-RFQ"}
                           · עובד: {testSupplierResult.receivedAt}
                        </div>
                      </div>
                    </div>

                    {/* Extracted fields table */}
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <tbody>
                        {[
                          ["מק״ט",          testSupplierResult.partNumber],
                          ["מחיר ליחידה",   testSupplierResult.quotedPrice != null
                            ? `${testSupplierResult.quotedPrice} ${testSupplierResult.currency || "USD"}`
                            : null],
                          ["זמן אספקה",     testSupplierResult.leadTimeDays != null
                            ? (testSupplierResult.leadTimeDays === 0 ? "במלאי" : `${testSupplierResult.leadTimeDays} ימים`)
                            : null],
                          ["כמות זמינה",    testSupplierResult.availableQty != null
                            ? testSupplierResult.availableQty.toLocaleString()
                            : null],
                          ["MOQ",            testSupplierResult.moq != null
                            ? testSupplierResult.moq.toLocaleString()
                            : null],
                          ["במלאי",          testSupplierResult.inStock != null
                            ? (testSupplierResult.inStock ? "כן ✓" : "לא")
                            : null],
                          ["הערות",         testSupplierResult.notes],
                        ].map(([label, value]) => value != null ? (
                          <tr key={label} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "6px 10px", color: "var(--text3)", fontWeight: 600, width: 120 }}>{label}</td>
                            <td style={{ padding: "6px 10px", color: "var(--text)", fontFamily: label === "מק״ט" ? "monospace" : "inherit" }}>
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
                      <span>ניקוד פירוט:</span>
                      <span style={{ color: "var(--accent)" }}>💰 מחיר (40)</span>
                      <span style={{ color: "#F472B6" }}>⏱ זמן אספקה (40)</span>
                      <span style={{ color: "#34D399" }}>📦 זמינות (20)</span>
                      <span style={{ marginRight: "auto" }}>
                        {testSupplierResult.score >= 70 ? "✅ הצעה טובה" : testSupplierResult.score >= 40 ? "⚠ הצעה בינונית" : "❌ הצעה חלשה"}
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
                📋 יומן פעילות
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
                  title={verboseLog ? "הסתר פרטים מורחבים" : "הצג פרטים מורחבים (פרטי שגיאות)"}
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
                >נקה</button>
              </div>
            </div>

            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {logs.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  אין רשומות ביומן עדיין
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
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>◂ חזרה שלב אחורה</div>
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
                סיבת החזרה <span style={{ color: "var(--red)" }}>*</span> (חובה)
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
                placeholder="לדוגמה: לקוח ביקש שינוי בכמות, שגיאה בפרטים שנשלחו..."
                style={{
                  width: "100%", minHeight: 80, padding: "10px 12px",
                  borderRadius: 8, resize: "vertical", outline: "none",
                  background: "var(--surface2)", border: `1px solid ${backComment.trim() ? "var(--accent)" : "var(--border)"}`,
                  color: "var(--text)", fontSize: 12, lineHeight: 1.6,
                  transition: "border-color 0.15s",
                }}
              />
              <div style={{ fontSize: 9, color: "var(--text3)", marginTop: 4, marginBottom: 16 }}>
                Ctrl+Enter לאישור · Esc לביטול
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setBackModal(null); setBackComment(''); }}
                  style={{
                    padding: "8px 18px", borderRadius: 8,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text2)", cursor: "pointer", fontSize: 11,
                  }}
                >ביטול</button>
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
                >אשר חזרה</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
