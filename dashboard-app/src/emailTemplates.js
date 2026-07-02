// Outbound HTML email builders. All RFQ fields originate from LLM-parsed, attacker-influenceable
// inbound email content, so every interpolated field must go through escapeHtml.
import { escapeHtml } from './exportUtils.js';

export function buildSupplierEmail(rfq) {
  const obsRow = rfq.isObsolete
    ? `<tr><th style="color:#e65100">Note</th><td style="color:#e65100"><b>OBSOLETE PART</b> — please confirm date code and country of origin</td></tr>`
    : '';
  const reqRow = rfq.specialRequirements
    ? `<tr><th>Special Requirements</th><td>${escapeHtml(rfq.specialRequirements)}</td></tr>`
    : '';
  return `<div dir="ltr" style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a2e">
<p>Dear Supplier,</p>
<p>We are requesting a quote for the following component on behalf of one of our customers:</p>
<table border="1" cellpadding="7" cellspacing="0" style="border-collapse:collapse;min-width:380px">
  <tr><th style="background:#f4f6fa;text-align:left;width:160px">Part Number</th><td><b style="font-family:monospace">${escapeHtml(rfq.partNumber)}</b></td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Quantity</th><td>${rfq.quantity?.toLocaleString()} pcs</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Required Delivery</th><td>${escapeHtml(rfq.deliveryDate) || 'ASAP — please advise lead time'}</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Target Price</th><td>${rfq.targetPrice != null ? '$' + rfq.targetPrice + ' / unit' : 'Open — please quote best price'}</td></tr>
  <tr><th style="background:#f4f6fa;text-align:left">Accepts Alternatives</th><td>${escapeHtml(rfq.acceptsAlternatives)}</td></tr>
  ${reqRow}${obsRow}
</table>
<p style="margin-top:14px">Please provide: <b>unit price</b>, <b>lead time</b>, <b>available quantity</b>, <b>MOQ</b>, and any relevant date code or condition information.</p>
<p>Best regards,<br><b>Procurement Team</b></p>
</div>`;
}

export function buildFollowUpEmail(missingDateParts) {
  const partsList = missingDateParts
    .map(r => `<li><b>${escapeHtml(r.partNumber)}</b> — ${escapeHtml(r.customerName)}</li>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:13px">
<p>Hello,</p>
<p>Thank you for your request for quotation.</p>
<p>In order to process your request efficiently, we need the <strong>required delivery date</strong> for the following parts:</p>
<ul>${partsList}</ul>
<p>Could you please specify the required delivery date?</p>
<p>Thank you,<br>Procurement Team</p>
</div>`;
}
