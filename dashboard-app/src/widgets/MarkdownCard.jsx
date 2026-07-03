// A titled card holding agent-authored prose — the agent's freeform "put some
// text / notes / a summary here" primitive. We render a tiny, safe markdown
// subset (bold, italic, inline code, bullet lists, line breaks) built entirely
// from React elements. We never use dangerouslySetInnerHTML, so no agent string
// can ever become live HTML/script regardless of what the model emits.

function renderInline(text) {
  // Split on **bold**, *italic*, and `code`, keeping the delimiters.
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part))     return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part))       return <code key={i} style={{ background: 'var(--surface3)', padding: '1px 5px', borderRadius: 4, fontSize: '0.9em' }}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

function renderBody(body) {
  const lines = String(body).split('\n');
  const blocks = [];
  let list = null;

  const flushList = () => {
    if (list) { blocks.push(<ul key={`ul-${blocks.length}`} style={{ margin: '4px 0', paddingLeft: 18 }}>{list}</ul>); list = null; }
  };

  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!list) list = [];
      list.push(<li key={i} style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>{renderInline(bullet[1])}</li>);
    } else {
      flushList();
      if (line.trim() === '') {
        blocks.push(<div key={i} style={{ height: 6 }} />);
      } else {
        blocks.push(<p key={i} style={{ margin: '2px 0', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>{renderInline(line)}</p>);
      }
    }
  });
  flushList();
  return blocks;
}

export function MarkdownCard({ title = 'Note', body = '', color = 'accent' }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: `var(--${color})`, marginBottom: 8 }}>📝 {title}</div>
      <div>{renderBody(body)}</div>
    </div>
  );
}
