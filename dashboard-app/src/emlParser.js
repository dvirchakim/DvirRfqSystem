// Minimal .eml parser: extracts From/To/Subject/Date plus best-effort plain-text body.
// Handles multipart boundaries, quoted-printable and base64 for text parts.

function decodeQuotedPrintable(str, charset = 'utf-8') {
  // Join soft line breaks
  const joined = str.replace(/=\r?\n/g, '');
  // Collect bytes
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /[0-9A-Fa-f]{2}/.test(joined.substr(i + 1, 2))) {
      bytes.push(parseInt(joined.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
}

function decodeBase64(str, charset = 'utf-8') {
  try {
    const bin = atob(str.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return str;
  }
}

function decodeMimeHeader(value) {
  if (!value) return '';
  return value.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, cs, enc, data) => {
    if (enc.toUpperCase() === 'Q') return decodeQuotedPrintable(data.replace(/_/g, ' '), cs);
    return decodeBase64(data, cs);
  });
}

function parseHeaders(block) {
  const headers = {};
  const lines = block.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ' ' + line.trim();
    } else {
      const m = line.match(/^([^:]+):\s?(.*)$/);
      if (m) {
        current = m[1].toLowerCase();
        headers[current] = m[2];
      }
    }
  }
  return headers;
}

function getContentType(headers) {
  const ct = headers['content-type'] || 'text/plain';
  const mime = ct.split(';')[0].trim().toLowerCase();
  const boundaryMatch = ct.match(/boundary="?([^";]+)"?/i);
  const charsetMatch = ct.match(/charset="?([^";]+)"?/i);
  return {
    mime,
    boundary: boundaryMatch ? boundaryMatch[1] : null,
    charset: charsetMatch ? charsetMatch[1] : 'utf-8',
  };
}

function decodeBody(body, headers, charset) {
  const enc = (headers['content-transfer-encoding'] || '7bit').toLowerCase().trim();
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  if (enc === 'base64') return decodeBase64(body, charset);
  return body;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(p|br|div|tr|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function splitHeaderBody(raw) {
  const idx = raw.search(/\r?\n\r?\n/);
  if (idx === -1) return { head: raw, body: '' };
  const headerEnd = idx + (raw[idx] === '\r' ? 4 : 2);
  return { head: raw.substring(0, idx), body: raw.substring(headerEnd) };
}

function extractTextFromPart(raw) {
  const { head, body } = splitHeaderBody(raw);
  const headers = parseHeaders(head);
  const { mime, boundary, charset } = getContentType(headers);

  if (boundary) {
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`));
    const decoded = parts
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => extractTextFromPart(p));

    // Prefer text/plain > text/html
    const plain = decoded.find(d => d.mime === 'text/plain' && d.text);
    if (plain) return plain;
    const html = decoded.find(d => d.mime === 'text/html' && d.text);
    if (html) return { mime: 'text/plain', text: stripHtml(html.text) };
    return decoded[0] || { mime, text: '' };
  }

  const decoded = decodeBody(body, headers, charset);
  return { mime, text: decoded };
}

export function parseEml(raw) {
  const { head, body } = splitHeaderBody(raw);
  const headers = parseHeaders(head);
  const from = decodeMimeHeader(headers['from'] || '');
  const to = decodeMimeHeader(headers['to'] || '');
  const subject = decodeMimeHeader(headers['subject'] || '');
  const date = headers['date'] || '';

  const { mime, boundary, charset } = getContentType(headers);
  let bodyText = '';
  if (boundary) {
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`));
    const decoded = parts
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => extractTextFromPart(p));
    const plain = decoded.find(d => d.mime === 'text/plain' && d.text && d.text.trim());
    if (plain) bodyText = plain.text;
    else {
      const html = decoded.find(d => d.mime === 'text/html' && d.text);
      if (html) bodyText = stripHtml(html.text);
    }
  } else {
    const decoded = decodeBody(body, headers, charset);
    bodyText = mime === 'text/html' ? stripHtml(decoded) : decoded;
  }

  bodyText = bodyText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    from,
    to,
    subject,
    date,
    body: bodyText,
    formatted: `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${bodyText}`,
  };
}
