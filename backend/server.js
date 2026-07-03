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

// ── OpenRouter tool definitions ───────────────────────────────────
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
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { messages = [], userId = 'default', apiKey: clientApiKey, model: clientModel } = req.body;
  const resolvedKey   = OPENROUTER_API_KEY || clientApiKey || '';
  const resolvedModel = clientModel || MODEL;

  if (!resolvedKey) {
    return res.status(503).json({ error: 'No OpenRouter API key — add one in Settings → OpenRouter.' });
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering

  const sse = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const allMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  const MAX_TURNS = 6;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let assistantText = '';
    const toolCalls   = [];

    try {
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${resolvedKey}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  FRONTEND_ORIGIN,
          'X-Title':       'DvirRfqSystem',
        },
        body: JSON.stringify({
          model:         resolvedModel,
          messages:      allMessages,
          tools:         TOOLS,
          tool_choice:   'auto',
          max_tokens:    2000,
          stream:        true,
        }),
      });

      if (!orRes.ok) {
        const txt = await orRes.text();
        sse('error', { message: `OpenRouter error ${orRes.status}: ${txt}` });
        break;
      }

      // Parse the SSE stream from OpenRouter
      const reader  = orRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block  = buffer.slice(0, boundary);
          buffer       = buffer.slice(boundary + 2);

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
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: '', function: { name: '', arguments: '' } };
              }
              if (tc.id)                    toolCalls[idx].id                     = tc.id;
              if (tc.function?.name)        toolCalls[idx].function.name         += tc.function.name;
              if (tc.function?.arguments)   toolCalls[idx].function.arguments    += tc.function.arguments;
            }
          }
        }
      }

      // Add assistant turn to history
      const asstMsg = { role: 'assistant', content: assistantText || null };
      if (toolCalls.length) {
        asstMsg.tool_calls = toolCalls.map(tc => ({
          id:       tc.id,
          type:     'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      allMessages.push(asstMsg);

      // No tool calls → done
      if (!toolCalls.length) break;

      // Execute each tool call
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* noop */ }

        let toolResult;

        if (tc.function.name === 'execute_readonly_sql') {
          sse('tool_call', { name: 'execute_readonly_sql', args });
          try {
            toolResult = await executeReadonlySQL(args.sql);
            sse('tool_result', { name: 'execute_readonly_sql', ok: true, rowCount: toolResult.rowCount });
          } catch (err) {
            toolResult = { error: err.message };
            sse('tool_result', { name: 'execute_readonly_sql', ok: false, error: err.message });
          }

        } else if (tc.function.name === 'update_user_ui_layout') {
          sse('tool_call', { name: 'update_user_ui_layout', args });
          try {
            const validated = validateLayout(args);
            await rwPool.query(
              `INSERT INTO user_ui_preferences (user_id, theme, layout_json)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id) DO UPDATE
                 SET theme=$2, layout_json=$3, updated_at=NOW()`,
              [userId, validated.theme, JSON.stringify(validated.components)]
            );
            toolResult = { ok: true };
            sse('layout_update', validated); // push new layout to frontend live
            sse('tool_result', { name: 'update_user_ui_layout', ok: true });
          } catch (err) {
            toolResult = { error: err.message };
            sse('tool_result', { name: 'update_user_ui_layout', ok: false, error: err.message });
          }
        } else {
          toolResult = { error: `Unknown tool: ${tc.function.name}` };
        }

        allMessages.push({
          role:         'tool',
          tool_call_id: tc.id,
          content:      JSON.stringify(toolResult),
        });
      }

    } catch (err) {
      console.error('[chat turn]', err.message);
      sse('error', { message: err.message });
      break;
    }
  }

  sse('done', {});
  res.end();
});

// ── Start ─────────────────────────────────────────────────────────
createServer(app).listen(PORT, () =>
  console.log(`[rfq-backend] listening on :${PORT}  model=${MODEL}`)
);
