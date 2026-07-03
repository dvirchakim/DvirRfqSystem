import { describe, it, expect } from 'vitest';
import { parseEml } from './emlParser.js';

describe('parseEml', () => {
  it('parses headers and a plain-text body from a simple .eml', () => {
    const raw = [
      'From: Jane Buyer <jane@example.com>',
      'To: sales@example.com',
      'Subject: RFQ for LM358DR',
      'Date: Mon, 1 Jun 2026 10:00:00 +0000',
      '',
      'Hello,',
      'Please quote LM358DR, qty 1000.',
      '',
    ].join('\r\n');

    const result = parseEml(raw);
    expect(result.from).toBe('Jane Buyer <jane@example.com>');
    expect(result.subject).toBe('RFQ for LM358DR');
    expect(result.body).toContain('Please quote LM358DR, qty 1000.');
  });

  it('decodes a quoted-printable body', () => {
    const raw = [
      'From: sender@example.com',
      'Subject: Test',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Price: =241.50 =E2=82=AC',
      '',
    ].join('\r\n');

    const result = parseEml(raw);
    expect(result.body).toContain('$1.50');
    expect(result.body).toContain('€');
  });

  it('prefers the text/plain part of a multipart message and strips HTML from the fallback', () => {
    const boundary = 'BOUNDARY123';
    const raw = [
      'From: sender@example.com',
      'Subject: Multipart test',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Plain text body',
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<p>HTML body</p>',
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const result = parseEml(raw);
    expect(result.body).toContain('Plain text body');
    expect(result.body).not.toContain('<p>');
  });

  it('decodes MIME-encoded (RFC 2047) subject headers', () => {
    const raw = [
      'From: sender@example.com',
      'Subject: =?UTF-8?B?4KO+4KOhIOCkleCkgQ==?=', // arbitrary UTF-8 base64 to exercise the decoder
      '',
      'body',
      '',
    ].join('\r\n');

    const result = parseEml(raw);
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.subject).not.toContain('=?UTF-8?B?');
  });
});
