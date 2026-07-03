import express       from 'express';
import cors          from 'cors';
import crypto        from 'crypto';
import rateLimit      from 'express-rate-limit';
import { createServer } from 'http';
import { rwPool, roPool, testConnection } from './db.js';
import { executeReadonlySQL, SCHEMA_CONTEXT } from './tools/executeReadonlySQL.js';
import { validateLayout } from './tools/validateLayout.js';
import { buildLayoutToolSchema, WIDGET_CATALOG_TEXT, THEMES } from './widgetSchema.js';

const app  = express();
const PORT = process.env.PORT || 3001;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL              = process.env.OPENROUTER_MODEL || 'nousresearch/hermes-3-llama-3-8b';
const FRONTEND_ORIGIN    = process.env.FRONTEND_ORIGIN  || 'http://localhost:8080';

const BACKEND_API_TOKEN     = process.env.BACKEND_API_TOKEN || '';
const ALLOW_UNAUTHENTICATED = process.env.ALLOW_UNAUTHENTICATED === 'true';

// Fail closed: refuse to start rather than silently serving an unauthenticated API.
if (!BACKEND_API_TOKEN && !ALLOW_UNAUTHENTICATED) {
  console.error('[rfq-backend] FATAL: BACKEND_API_TOKEN is not set.');
  console.error('[rfq-backend] Generate one with `openssl rand -hex 32`, set it in your .env,');
  console.error('[rfq-backend] and paste the same value into the frontend Settings -> AI Agent tab.');
  console.error('[rfq-backend] For local-only testing with no auth, set ALLOW_UNAUTHENTICATED=true instead.');
  process.exit(1);
}
if (ALLOW_UNAUTHENTICATED) {
  console.warn('[rfq-backend] WARNING: ALLOW_UNAUTHENTICATED=true — every API endpoint is open. Do not expose this beyond localhost.');
}

// Constant-time token comparison — a naive `===` leaks timing information an
// attacker could use to guess the token byte-by-byte.
function tokenMatches(candidate) {
  const a = Buffer.from(candidate || '');
  const b = Buffer.from(BACKEND_API_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (ALLOW_UNAUTHENTICATED) return next();
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !tokenMatches(token)) {
    return res.status(401).json({ error: 'Unauthorized — missing or invalid API token.' });
  }
  next();
}

// ── Middleware ────────────────────────────────────────────────────
app.set('trust proxy', 1); // behind nginx — needed so rate limiting sees real client IPs
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '4mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests — please wait a few minutes and try again.' },
});

// ── Health (unauthenticated on purpose — used by the frontend's connectivity
//    check — but deliberately reveals nothing about model/key configuration) ──
app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try { await testConnection(); dbOk = true; } catch { /* noop */ }
  res.json({ ok: true, db: dbOk });
});

// Everything below this line requires a valid API token (unless ALLOW_UNAUTHENTICATED).
app.use('/api', requireAuth, apiLimiter);

// ── Sync RFQs from frontend ───────────────────────────────────────
app.post('/api/rfqs/sync', async (req, res) => {
  const { rfqs } = req.body;
  if (!Array.isArray(rfqs)) return res.status(400).json({ error: 'rfqs must be an array' });

  const client = await rwPool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rfqs) {
      await client.query(
        `INSERT INTO rfqs
           (id, customer_name, part_number, quantity, delivery_date,
            accepts_alternatives, target_price, status, priority,
            is_obsolete, special_requirements, summary, sender, from_email, human_loop)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           customer_name        = EXCLUDED.customer_name,
           part_number          = EXCLUDED.part_number,
           quantity             = EXCLUDED.quantity,
           delivery_date        = EXCLUDED.delivery_date,
           accepts_alternatives = EXCLUDED.accepts_alternatives,
           target_price         = EXCLUDED.target_price,
           status               = EXCLUDED.status,
           priority             = EXCLUDED.priority,
           is_obsolete          = EXCLUDED.is_obsolete,
           special_requirements = EXCLUDED.special_requirements,
           summary              = EXCLUDED.summary,
           human_loop           = EXCLUDED.human_loop,
           updated_at           = NOW()`,
        [r.id, r.customerName, r.partNumber, r.quantity, r.deliveryDate,
         r.acceptsAlternatives, r.targetPrice ?? null, r.status, r.priority,
         !!r.isObsolete, r.specialRequirements ?? null, r.summary ?? null,
         r.sender ?? null, r.fromEmail ?? null, !!r.humanLoop]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, synced: rfqs.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[rfqs/sync]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Get user layout ───────────────────────────────────────────────
app.get('/api/user/:userId/layout', async (req, res) => {
  try {
    const { rows } = await rwPool.query(
      'SELECT theme, layout_json FROM user_ui_preferences WHERE user_id = $1',
      [req.params.userId]
    );
    if (!rows.length) return res.json({ theme: 'dark', components: [] });
    res.json({ theme: rows[0].theme, components: rows[0].layout_json });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Save user layout ──────────────────────────────────────────────
app.post('/api/user/:userId/layout', async (req, res) => {
  let validated;
  try {
    validated = validateLayout(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    await rwPool.query(
      `INSERT INTO user_ui_preferences (user_id, theme, layout_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET theme=$2, layout_json=$3, updated_at=NOW()`,
      [req.params.userId, validated.theme, JSON.stringify(validated.components)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tool definitions (OpenAI/OpenRouter/Ollama function-calling shape) ─────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'execute_readonly_sql',
      description:
        'Run a read-only SELECT query against the live RFQ database. ' +
        'Returns rows, field names, and a row count. Only SELECT is allowed.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'A valid PostgreSQL SELECT statement targeting the rfqs table.',
          },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_user_ui_layout',
      description:
        "Reshape the user's dashboard in real time — choose a theme and an ordered " +
        'list of widgets to display, each configured with its own props. Use this whenever ' +
        'the user asks to change, add to, rearrange, or customize the dashboard/UI.',
      parameters: buildLayoutToolSchema(),
    },
  },
];

// Anthropic's Messages API uses a flatter tool shape (name/description/input_schema,
// no function-call wrapper) — derive it from the same TOOLS array so the two can
// never drift apart.
const TOOLS_ANTHROPIC = TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

const SYSTEM_PROMPT = `You are an embedded AI assistant inside an RFQ (Request for Quotation) management platform.

You have two capabilities:
1. Answer questions about live RFQ data using the execute_readonly_sql tool.
2. Build and reshape the user's dashboard using the update_user_ui_layout tool — this is
   how you "change the UI" or "add functionality" when the user asks. You assemble the UI
   from the widget catalog below; you cannot write code, only compose these widgets.

${SCHEMA_CONTEXT}

AVAILABLE DASHBOARD WIDGETS (compose the UI from these):
${WIDGET_CATALOG_TEXT}

Themes: ${THEMES.join(', ')}.

How to handle UI requests:
- When the user asks to change/add/rearrange the dashboard, call update_user_ui_layout with the
  FULL desired list of components (it replaces the current layout, so include everything you
  want shown, in order).
- Pick the widgets that best answer the intent. Examples:
  • "show me a breakdown by status" → a BarChart with dimension "status".
  • "add a card with total high-priority count" → a MetricCard with metric "high_priority".
  • "give me buttons to export and connect gmail" → an ActionButtons widget with those actions.
  • "write a short summary at the top" → a MarkdownCard; you may first query data with SQL,
    then put your findings in the card's body using markdown.
- You can combine data questions with UI changes: query with execute_readonly_sql, then reflect
  the answer in a MarkdownCard or the widgets you choose.

Rules:
- Always use execute_readonly_sql for data questions — never guess numbers.
- Only use widget types and prop values from the catalog above; anything else is dropped.
- Be concise. Format SQL results as markdown tables when helpful.
- Never expose internal IDs, passwords, or configuration details.`;

// ── Chat endpoint — SSE streaming ─────────────────────────────────
// Executes one tool call. Provider-agnostic — every provider funnels through this,
// so the SQL/layout guardrails apply identically no matter which LLM is calling them.
async function runTool(name, args, userId, sse) {
  if (name === 'execute_readonly_sql') {
    sse('tool_call', { name, args });
    try {
      const result = await executeReadonlySQL(args.sql);
      sse('tool_result', { name, ok: true, rowCount: result.rowCount });
      return result;
    } catch (err) {
      sse('tool_result', { name, ok: false, error: err.message });
      return { error: err.message };
    }
  }

  if (name === 'update_user_ui_layout') {
    sse('tool_call', { name, args });
    try {
      const validated = validateLayout(args);
      await rwPool.query(
        `INSERT INTO user_ui_preferences (user_id, theme, layout_json)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET theme=$2, layout_json=$3, updated_at=NOW()`,
        [userId, validated.theme, JSON.stringify(validated.components)]
      );
      sse('layout_update', validated); // push new layout to frontend live
      sse('tool_result', { name, ok: true });
      return { ok: true };
    } catch (err) {
      sse('tool_result', { name, ok: false, error: err.message });
      return { error: err.message };
    }
  }

  return { error: `Unknown tool: ${name}` };
}

// ── OpenAI-compatible chat/completions (OpenRouter, OpenAI, and any
//    OpenAI-compatible endpoint the user points at) ─────────────────────────
async function runOpenAICompatibleChat({ baseUrl, apiKey, model, messages, userId, sse, extraHeaders = {} }) {
  const allMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let assistantText = '';
    const toolCalls = [];

    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify({
        model, messages: allMessages, tools: TOOLS, tool_choice: 'auto',
        max_tokens: 2000, stream: true,
      }),
    });

    if (!apiRes.ok) {
      const txt = await apiRes.text();
      sse('error', { message: `LLM provider error ${apiRes.status}: ${txt}` });
      return;
    }

    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let dataLine = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
        }
        if (!dataLine || dataLine === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(dataLine); } catch { continue; }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          assistantText += delta.content;
          sse('delta', { content: delta.content });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', function: { name: '', arguments: '' } };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
    }

    const asstMsg = { role: 'assistant', content: assistantText || null };
    if (toolCalls.length) {
      asstMsg.tool_calls = toolCalls.map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    allMessages.push(asstMsg);

    if (!toolCalls.length) return;

    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* noop */ }
      const result = await runTool(tc.function.name, args, userId, sse);
      allMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
}

// ── Anthropic Messages API — native tool_use streaming, a different shape
//    from OpenAI's (system is top-level, tool results go back as a user-role
//    message with tool_result content blocks, no role:'tool'). ────────────
async function runAnthropicChat({ apiKey, model, messages, userId, sse }) {
  const allMessages = [...messages]; // system passed separately below

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, system: SYSTEM_PROMPT, messages: allMessages,
        tools: TOOLS_ANTHROPIC, max_tokens: 2000, stream: true,
      }),
    });

    if (!apiRes.ok) {
      const txt = await apiRes.text();
      sse('error', { message: `Anthropic error ${apiRes.status}: ${txt}` });
      return;
    }

    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const blocks = []; // { type: 'text'|'tool_use', text?, id?, name?, jsonBuf? }
    let stopReason = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let dataLine = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
        }
        if (!dataLine) continue;

        let evt;
        try { evt = JSON.parse(dataLine); } catch { continue; }

        if (evt.type === 'content_block_start') {
          const cb = evt.content_block;
          blocks[evt.index] = cb.type === 'tool_use'
            ? { type: 'tool_use', id: cb.id, name: cb.name, jsonBuf: '' }
            : { type: 'text', text: '' };
        } else if (evt.type === 'content_block_delta') {
          const b = blocks[evt.index];
          if (!b) continue;
          if (evt.delta.type === 'text_delta') {
            b.text += evt.delta.text;
            sse('delta', { content: evt.delta.text });
          } else if (evt.delta.type === 'input_json_delta') {
            b.jsonBuf += evt.delta.partial_json;
          }
        } else if (evt.type === 'message_delta') {
          stopReason = evt.delta?.stop_reason || stopReason;
        }
      }
    }

    // Build the assistant turn from the accumulated blocks.
    const content = blocks.filter(Boolean).map(b => b.type === 'tool_use'
      ? { type: 'tool_use', id: b.id, name: b.name, input: safeParseJson(b.jsonBuf) }
      : { type: 'text', text: b.text });
    allMessages.push({ role: 'assistant', content });

    const toolUseBlocks = blocks.filter(b => b && b.type === 'tool_use');
    if (stopReason !== 'tool_use' || !toolUseBlocks.length) return;

    const toolResults = [];
    for (const tb of toolUseBlocks) {
      const args = safeParseJson(tb.jsonBuf) || {};
      const result = await runTool(tb.name, args, userId, sse);
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: JSON.stringify(result) });
    }
    allMessages.push({ role: 'user', content: toolResults });
  }
}

function safeParseJson(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

// ── Ollama — local models. Tool-calling support varies a lot by model, so
//    this uses Ollama's non-streaming /api/chat (tool_calls come back fully
//    formed, no delta assembly needed) and just emits the whole reply as one
//    delta. NOTE: if the backend runs in Docker, "localhost" in ollamaBaseUrl
//    refers to the *container*, not the host machine — use
//    http://host.docker.internal:11434 (Docker Desktop) instead. ───────────
async function runOllamaChat({ baseUrl, model, messages, userId, sse }) {
  if (/localhost|127\.0\.0\.1/.test(baseUrl)) {
    console.warn(`[rfq-backend] Ollama base URL "${baseUrl}" points at localhost, which inside a ` +
      `Docker container means the container itself, not your host machine. If the agent can't ` +
      `reach Ollama, use http://host.docker.internal:11434 instead.`);
  }

  const allMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const url = baseUrl.replace(/\/$/, '') + '/api/chat';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: allMessages, tools: TOOLS, stream: false }),
    });

    if (!apiRes.ok) {
      sse('error', { message: `Ollama error ${apiRes.status}: ${await apiRes.text().catch(() => '')}` });
      return;
    }

    const data = await apiRes.json();
    const msg = data.message || {};
    if (msg.content) sse('delta', { content: msg.content });

    const toolCalls = msg.tool_calls || [];
    allMessages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });
    if (!toolCalls.length) return;

    for (const tc of toolCalls) {
      const rawArgs = tc.function?.arguments;
      const args = typeof rawArgs === 'string' ? safeParseJson(rawArgs) : (rawArgs || {});
      const result = await runTool(tc.function?.name, args, userId, sse);
      allMessages.push({ role: 'tool', content: JSON.stringify(result) });
    }
  }
}

const MAX_TURNS = 6;

// ── Chat endpoint — SSE streaming. Dispatches to whichever LLM provider the
//    frontend already has configured (the same one used for RFQ parsing) —
//    there is no separate "agent provider" to set up. ──────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  const {
    messages = [], userId = 'default', provider = 'openrouter',
    anthropicApiKey, anthropicModel,
    openaiApiKey, openaiBaseUrl, openaiModel,
    ollamaBaseUrl, ollamaModel,
    openrouterApiKey, openrouterModel,
  } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (provider === 'anthropic') {
      if (!anthropicApiKey) {
        sse('error', { message: 'No Anthropic API key — add one in Settings.' });
      } else {
        await runAnthropicChat({
          apiKey: anthropicApiKey, model: anthropicModel || 'claude-sonnet-4-6',
          messages, userId, sse,
        });
      }
    } else if (provider === 'openai') {
      if (!openaiApiKey || !openaiBaseUrl) {
        sse('error', { message: 'No OpenAI-compatible API key/base URL — add one in Settings.' });
      } else {
        await runOpenAICompatibleChat({
          baseUrl: openaiBaseUrl, apiKey: openaiApiKey, model: openaiModel || 'gpt-4o-mini',
          messages, userId, sse,
        });
      }
    } else if (provider === 'ollama') {
      await runOllamaChat({
        baseUrl: ollamaBaseUrl || 'http://localhost:11434', model: ollamaModel || 'llama3.1',
        messages, userId, sse,
      });
    } else {
      // openrouter — client key first, server-configured key as a deployer-level fallback.
      const key = openrouterApiKey || OPENROUTER_API_KEY;
      if (!key) {
        sse('error', { message: 'No OpenRouter API key — add one in Settings → OpenRouter.' });
      } else {
        await runOpenAICompatibleChat({
          baseUrl: 'https://openrouter.ai/api/v1', apiKey: key, model: openrouterModel || MODEL,
          messages, userId, sse,
          extraHeaders: { 'HTTP-Referer': FRONTEND_ORIGIN, 'X-Title': 'RFQ Dashboard' },
        });
      }
    }
  } catch (err) {
    console.error('[chat]', err.message);
    sse('error', { message: err.message });
  }

  sse('done', {});
  res.end();
});

// ── Start ─────────────────────────────────────────────────────────
createServer(app).listen(PORT, () =>
  console.log(`[rfq-backend] listening on :${PORT}  model=${MODEL}`)
);
