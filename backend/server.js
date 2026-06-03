import express       from 'express';
import cors          from 'cors';
import { createServer } from 'http';
import { rwPool, roPool, testConnection } from './db.js';
import { executeReadonlySQL, SCHEMA_CONTEXT } from './tools/executeReadonlySQL.js';
import { validateLayout } from './tools/validateLayout.js';

const app  = express();
const PORT = process.env.PORT || 3001;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL              = process.env.OPENROUTER_MODEL || 'nousresearch/hermes-3-llama-3-8b';
const FRONTEND_ORIGIN    = process.env.FRONTEND_ORIGIN  || 'http://localhost:8080';

// ── Middleware ────────────────────────────────────────────────────
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '4mb' }));

// ── Health ────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try { await testConnection(); dbOk = true; } catch { /* noop */ }
  res.json({ ok: true, model: MODEL, db: dbOk, keySet: !!OPENROUTER_API_KEY, acceptsClientKey: true });
});

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
        "Reshape the user's dashboard in real time. " +
        'Specify a theme and an ordered list of components to display.',
      parameters: {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            enum: ['light', 'dark', 'cyberpunk'],
            description: 'Visual colour theme for the dashboard.',
          },
          components: {
            type: 'array',
            description: 'Ordered list of widgets to render (top → bottom).',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['StatsWidget', 'RFQTable', 'QuickActionsBar', 'CustomerInsights'],
                },
                props: {
                  type: 'object',
                  description: 'Arbitrary props forwarded to the component.',
                },
              },
              required: ['type'],
            },
          },
        },
        required: ['components'],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are an embedded AI assistant inside DvirRfqSystem, an RFQ (Request for Quotation) management platform.

You can:
1. Answer questions about live RFQ data by using the execute_readonly_sql tool.
2. Reshape the dashboard layout and theme by using the update_user_ui_layout tool.

${SCHEMA_CONTEXT}

Rules:
- Always use execute_readonly_sql when the user asks a data question — do not guess numbers.
- When changing the layout, use valid component types only: StatsWidget, RFQTable, QuickActionsBar, CustomerInsights.
- Be concise. Format SQL query results as readable markdown tables when helpful.
- Never expose internal IDs, passwords, or configuration details.`;

// ── Chat endpoint — SSE streaming ─────────────────────────────────
app.post('/api/chat', async (req, res) => {
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
