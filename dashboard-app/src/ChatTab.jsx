import { useState, useRef, useEffect, useCallback } from 'react';
import { LayoutEngine, DEFAULT_LAYOUT } from './layoutEngine.jsx';

const API = '/api';
const SUGGESTED = [
  'How many RFQs are currently pending?',
  'Which customer has the most high-priority requests?',
  'Show me a summary of completed RFQs this week.',
  'Switch to Cyberpunk dark mode and put StatsWidget first.',
  'Show only the RFQ table and customer insights in light mode.',
];

// ── Conversation persistence (localStorage) ───────────────────────
const CONV_KEY = 'rfq-chat-convs';
const loadConvs    = ()      => { try { return JSON.parse(localStorage.getItem(CONV_KEY) || '[]'); } catch { return []; } };
const saveConv     = (conv)  => { const list = loadConvs().filter(c => c.id !== conv.id); localStorage.setItem(CONV_KEY, JSON.stringify([conv, ...list].slice(0, 100))); };
const deleteConvLS = (id)    => { localStorage.setItem(CONV_KEY, JSON.stringify(loadConvs().filter(c => c.id !== id))); };

// ── Parse a fetch ReadableStream as SSE ──────────────────────────
async function* streamSSE(response) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer      = buffer.slice(boundary + 2);

      let event = 'message';
      let data  = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: '))  data  = line.slice(6).trim();
      }
      if (data) yield { event, data };
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────
function ToolCallCard({ name, args, result }) {
  const [open, setOpen] = useState(false);
  const isSQL    = name === 'execute_readonly_sql';
  const isLayout = name === 'update_user_ui_layout';

  return (
    <div style={{
      margin: '6px 0', borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${isSQL ? 'var(--accent)30' : 'var(--pink)30'}`,
      background: isSQL ? 'var(--surface2)' : '#F472B608',
      fontSize: 11,
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span>{isSQL ? '🔍' : '🎨'}</span>
        <span style={{ fontWeight: 600, color: isSQL ? 'var(--accent)' : 'var(--pink)' }}>
          {isSQL ? 'SQL Query' : 'Layout Update'}
        </span>
        {result && (
          <span style={{
            marginLeft: 'auto', fontSize: 9, padding: '2px 6px', borderRadius: 4,
            background: result.ok ? 'var(--green)20' : 'var(--red)20',
            color: result.ok ? 'var(--green)' : 'var(--red)',
          }}>
            {result.ok
              ? (isSQL ? `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''}` : '✓ applied')
              : `✗ ${result.error}`}
          </span>
        )}
        {!result && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--amber)' }}>⏳ running…</span>}
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--border)' }}>
          {isSQL && (
            <pre style={{
              margin: '8px 0 0', padding: '8px 10px', borderRadius: 6,
              background: 'var(--surface3)', color: 'var(--accent)', fontSize: 10,
              overflowX: 'auto', whiteSpace: 'pre-wrap', direction: 'ltr',
            }}>{args.sql}</pre>
          )}
          {isLayout && args.components && (
            <div style={{ marginTop: 8, color: 'var(--text2)', fontSize: 10 }}>
              Theme: <b>{args.theme || 'dark'}</b> · Components: {args.components.map(c => c.type).join(', ')}
            </div>
          )}
          {result?.rows?.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, direction: 'ltr' }}>
                <thead>
                  <tr style={{ background: 'var(--surface3)', color: 'var(--text3)' }}>
                    {result.fields.map(f => (
                      <th key={f} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600 }}>{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                      {result.fields.map(f => (
                        <td key={f} style={{ padding: '4px 8px', color: 'var(--text2)' }}>
                          {String(row[f] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12, animation: 'slideIn 0.2s ease',
    }}>
      <div style={{
        maxWidth: '88%',
        background: isUser ? 'var(--accent)20' : 'var(--surface)',
        border: `1px solid ${isUser ? 'var(--accent)40' : 'var(--border)'}`,
        borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
        padding: '10px 14px', fontSize: 12, lineHeight: 1.65,
        color: 'var(--text)', direction: 'rtl', wordBreak: 'break-word',
      }}>
        {msg.content}
        {msg.streaming && (
          <span style={{
            display: 'inline-block', width: 7, height: 12, marginLeft: 3,
            background: 'var(--accent)', borderRadius: 1,
            animation: 'pulse 0.8s ease-in-out infinite', verticalAlign: 'text-bottom',
          }} />
        )}
      </div>
      {msg.events?.map((ev, i) => (
        <div key={i} style={{ maxWidth: '88%', width: '100%', marginTop: 4 }}>
          {ev.type === 'tool_call' && (
            <ToolCallCard
              name={ev.name}
              args={ev.args}
              result={msg.toolResults?.[i]}
            />
          )}
          {ev.type === 'layout_update' && (
            <div style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 6,
              background: 'var(--pink)15', color: 'var(--pink)',
              border: '1px solid var(--pink)30', marginTop: 4,
            }}>
              🎨 Layout updated — theme: <b>{ev.layout.theme}</b> · {ev.layout.components.length} widget{ev.layout.components.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main ChatTab component ────────────────────────────────────────
export function ChatTab({ rfqs = [], userId = 'default', onLayoutUpdate }) {
  const [messages,       setMessages]       = useState([]);
  const [input,          setInput]          = useState('');
  const [streaming,      setStreaming]      = useState(false);
  const [layout,         setLayout]         = useState(null);
  const [backendOk,      setBackendOk]      = useState(null);
  const [showPreview,    setShowPreview]    = useState(true);
  const [showHistory,    setShowHistory]    = useState(false);
  const [conversations,  setConversations]  = useState(() => loadConvs());
  const [currentConvId,  setCurrentConvId]  = useState(null);
  const endRef     = useRef(null);
  const inputRef   = useRef(null);
  const historyRef = useRef([]);
  const abortRef   = useRef(null);

  const getOrKey   = () => localStorage.getItem('rfq-openrouter-key')   || '';
  const getOrModel  = () => localStorage.getItem('rfq-openrouter-model') || 'nousresearch/hermes-3-llama-3-8b';

  // Check backend health on mount
  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setBackendOk(d.ok && (d.keySet || d.acceptsClientKey)))
      .catch(() => setBackendOk(false));
  }, []);

  // Sync RFQs to backend whenever they change
  useEffect(() => {
    if (!rfqs.length) return;
    fetch(`${API}/rfqs/sync`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rfqs }),
    }).catch(() => {});
  }, [rfqs]);

  // Load user layout on mount
  useEffect(() => {
    fetch(`${API}/user/${encodeURIComponent(userId)}/layout`)
      .then(r => r.json())
      .then(d => {
        if (d.components?.length) {
          setLayout(d);
          onLayoutUpdate?.(d);
        }
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const applyLayout = useCallback((newLayout) => {
    setLayout(newLayout);
    onLayoutUpdate?.(newLayout);
  }, [onLayoutUpdate]);

  const send = useCallback(async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || streaming) return;
    setInput('');

    const convId = currentConvId || `conv-${Date.now()}`;
    if (!currentConvId) setCurrentConvId(convId);

    const userMsg = { role: 'user', content: trimmed };
    const msgId   = Date.now();
    historyRef.current = [...historyRef.current, { role: 'user', content: trimmed }];

    setMessages(prev => [
      ...prev,
      userMsg,
      { role: 'assistant', id: msgId, content: '', streaming: true, events: [], toolResults: {} },
    ]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    let contentAccum = '';
    const pendingEvents  = [];
    const pendingResults = {};

    try {
      const res = await fetch(`${API}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  abort.signal,
        body:    JSON.stringify({
          messages: historyRef.current.slice(-20),
          userId,
          apiKey: getOrKey(),
          model:  getOrModel(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, content: `❌ ${err.error}`, streaming: false } : m
        ));
        return;
      }

      for await (const { event, data } of streamSSE(res)) {
        if (abort.signal.aborted) break;
        let payload;
        try { payload = JSON.parse(data); } catch { continue; }

        if (event === 'delta') {
          contentAccum += payload.content;
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, content: contentAccum } : m
          ));
        }
        if (event === 'tool_call') {
          pendingEvents.push({ type: 'tool_call', name: payload.name, args: payload.args });
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, events: [...pendingEvents] } : m
          ));
        }
        if (event === 'tool_result') {
          const idx = [...pendingEvents].reverse().findIndex(
            e => e.type === 'tool_call' && e.name === payload.name
          );
          const realIdx = idx !== -1 ? pendingEvents.length - 1 - idx : pendingEvents.length - 1;
          pendingResults[realIdx] = payload;
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, toolResults: { ...pendingResults } } : m
          ));
        }
        if (event === 'layout_update') {
          applyLayout(payload);
          pendingEvents.push({ type: 'layout_update', layout: payload });
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, events: [...pendingEvents] } : m
          ));
        }
        if (event === 'error') {
          contentAccum += `\n\n❌ ${payload.message}`;
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, content: contentAccum } : m
          ));
        }
        if (event === 'done') break;
      }

      if (!abort.signal.aborted) {
        historyRef.current = [...historyRef.current, { role: 'assistant', content: contentAccum }];
      }

    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, content: `❌ ${err.message}`, streaming: false } : m
        ));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === msgId
            ? { ...m, streaming: false, ...(abort.signal.aborted && !m.content ? { content: '⏹ Stopped.' } : {}) }
            : m
        );
        const title = updated.find(m => m.role === 'user')?.content?.slice(0, 60) || 'New chat';
        saveConv({ id: convId, title, messages: updated, ts: Date.now() });
        setConversations(loadConvs());
        return updated;
      });
    }
  }, [input, streaming, userId, applyLayout, currentConvId]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    setCurrentConvId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const loadConv = useCallback((conv) => {
    setMessages(conv.messages || []);
    historyRef.current = (conv.messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));
    setCurrentConvId(conv.id);
    setShowHistory(false);
  }, []);

  const deleteConv = useCallback((id, e) => {
    e.stopPropagation();
    deleteConvLS(id);
    const updated = loadConvs();
    setConversations(updated);
    if (id === currentConvId) newChat();
  }, [currentConvId, newChat]);

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 160px)', minHeight: 400, animation: 'slideIn 0.3s ease' }}>

      {/* ── History sidebar ────────────────────────────────────── */}
      {showHistory && (
        <div style={{
          width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--border)', paddingRight: 12, marginRight: 16,
          overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>💬 History</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {conversations.length > 0 && (
                <button
                  onClick={() => { if (window.confirm('Clear all conversation history?')) { localStorage.removeItem(CONV_KEY); setConversations([]); newChat(); } }}
                  title="Clear all"
                  style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'var(--red)15', color: 'var(--red)', border: '1px solid var(--red)30' }}
                >Clear all</button>
              )}
              <button
                onClick={() => setShowHistory(false)}
                style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'var(--surface2)', color: 'var(--text3)', border: '1px solid var(--border)' }}
              >✕</button>
            </div>
          </div>

          <button
            onClick={newChat}
            style={{
              padding: '8px 10px', borderRadius: 8, marginBottom: 8, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', background: 'var(--accent)15', color: 'var(--accent)',
              border: '1px solid var(--accent)40', textAlign: 'left',
            }}
          >+ New chat</button>

          {conversations.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '12px 0', textAlign: 'center' }}>No conversations yet</div>
          )}

          {conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => loadConv(conv)}
              style={{
                padding: '8px 10px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                background: conv.id === currentConvId ? 'var(--accent)15' : 'transparent',
                border: `1px solid ${conv.id === currentConvId ? 'var(--accent)40' : 'transparent'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: 6, transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (conv.id !== currentConvId) e.currentTarget.style.background = 'var(--surface2)'; }}
              onMouseLeave={e => { if (conv.id !== currentConvId) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: conv.id === currentConvId ? 600 : 400 }}>
                  {conv.title}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
                  {new Date(conv.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <button
                onClick={e => deleteConv(conv.id, e)}
                title="Delete"
                style={{
                  flexShrink: 0, padding: '1px 5px', borderRadius: 4, fontSize: 10,
                  cursor: 'pointer', background: 'transparent', color: 'var(--text3)',
                  border: 'none', opacity: 0.6,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.opacity = '0.6'; }}
              >🗑</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Chat panel ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>🤖 AI Agent</h2>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
              {backendOk === null  && '⧏ Checking backend…'}
              {backendOk === true  && `✅ Connected · ${getOrModel()}`}
              {backendOk === false && '⚠ Backend unreachable — is docker-compose running?'}
              {backendOk === true  && !getOrKey() && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>⚠ Add OpenRouter key in Settings → OpenRouter tab first</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setShowHistory(h => !h); }}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                cursor: 'pointer', background: showHistory ? 'var(--accent)20' : 'var(--surface2)',
                color: showHistory ? 'var(--accent)' : 'var(--text2)',
                border: `1px solid ${showHistory ? 'var(--accent)40' : 'var(--border)'}`,
              }}
            >
              💬 History {conversations.length > 0 && `(${conversations.length})`}
            </button>
            <button
              onClick={newChat}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                cursor: 'pointer', background: 'var(--surface2)', color: 'var(--text2)',
                border: '1px solid var(--border)',
              }}
            >+ New</button>
            <button
              onClick={() => setShowPreview(p => !p)}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                cursor: 'pointer', background: 'var(--surface2)', color: 'var(--text2)',
                border: '1px solid var(--border)',
              }}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '4px 2px',
          display: 'flex', flexDirection: 'column',
        }}>
          {messages.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
                Ask me about your RFQ pipeline, or ask me to reshape the dashboard.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                {SUGGESTED.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={streaming || backendOk === false}
                    style={{
                      padding: '6px 12px', borderRadius: 16, fontSize: 10,
                      cursor: 'pointer', background: 'var(--surface2)',
                      color: 'var(--text2)', border: '1px solid var(--border)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={msg.id ?? i} msg={msg} />
          ))}
          <div ref={endRef} />
        </div>

        {/* Input area */}
        <div style={{
          marginTop: 10, background: 'var(--surface)', borderRadius: 12,
          border: '1px solid var(--border)', padding: 10, display: 'flex', gap: 8,
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={streaming || backendOk === false}
            placeholder={backendOk === false ? 'Backend not available — check docker-compose' : 'Ask a question or request a layout change… (Enter to send)'}
            rows={2}
            style={{
              flex: 1, resize: 'none', outline: 'none',
              background: 'transparent', border: 'none',
              color: 'var(--text)', fontSize: 12, lineHeight: 1.6,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-end' }}>
            {streaming ? (
              <button
                onClick={stop}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', background: 'var(--red)', color: '#fff',
                  border: 'none', whiteSpace: 'nowrap', animation: 'pulse 1.2s ease-in-out infinite',
                }}
              >⏹ Stop</button>
            ) : (
              <button
                onClick={() => send()}
                disabled={!input.trim() || backendOk === false}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: !input.trim() ? 'default' : 'pointer',
                  background: !input.trim() ? 'var(--surface3)' : 'var(--accent)',
                  color:  !input.trim() ? 'var(--text3)' : '#000',
                  border: 'none', whiteSpace: 'nowrap',
                }}
              >▶ Send</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Live preview panel ──────────────────────────────────── */}
      {showPreview && (
        <div style={{
          width: 280, flexShrink: 0, overflowY: 'auto',
          borderLeft: '1px solid var(--border)', paddingLeft: 16,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase' }}>
            Live Layout Preview
          </div>
          {layout ? (
            <LayoutEngine layout={layout} rfqs={rfqs} />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
              Ask the agent to reshape the dashboard to see a live preview here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
