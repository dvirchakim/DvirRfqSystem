// Export utilities: Excel (SheetJS) and PDF (print window)
import * as XLSX from 'xlsx';

const STATUS_COLORS = {
  new: '#38BDF8', processing: '#FBBF24', parsed: '#A78BFA',
  ready: '#34D399', distributed: '#F472B6', awaiting: '#FB923C',
  completed: '#4ADE80', error: '#F87171',
};

export function exportToExcel(rfqs) {
  const rows = rfqs.map(r => ({
    'שם לקוח':        r.customerName  || '',
    'מק״ט יצרן':      r.partNumber    || '',
    'כמות':           r.quantity      ?? '',
    'תאריך אספקה':    r.deliveryDate  || '',
    'מוכן לתחליפי':   r.acceptsAlternatives || '',
    'מחיר מטרה ($)':  r.targetPrice   != null ? r.targetPrice : '',
    'דרישות מיוחדות': r.specialRequirements || '',
    'אובסולייט':      r.isObsolete    ? 'כן' : 'לא',
    'סטטוס':          r.status        || '',
    'עדיפות':         r.priority      || '',
    'שולח':           r.sender        || '',
    'תאריך עיבוד':    r.createdAt ? new Date(r.createdAt).toLocaleDateString('he-IL') : '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  ws['!cols'] = [
    { wch: 20 }, { wch: 24 }, { wch: 10 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 38 }, { wch: 10 },
    { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'RFQs');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `rfq-rfq-${date}.xlsx`);
}

export function exportToPDF(rfqs) {
  const rows = rfqs.map(r => {
    const color = STATUS_COLORS[r.status] || '#888';
    return `
      <tr style="${r.isObsolete ? 'background:#fff8e1' : ''}">
        <td style="${r.priority === 'high' ? 'border-right:3px solid #ef4444' : ''}">${r.customerName}</td>
        <td class="mono">${r.partNumber}${r.isObsolete ? ' <b style="color:#e65100;font-size:8px">OBS</b>' : ''}</td>
        <td class="center">${r.quantity?.toLocaleString() ?? ''}</td>
        <td>${r.deliveryDate || '—'}</td>
        <td class="center">${r.acceptsAlternatives}</td>
        <td class="mono">${r.targetPrice != null ? '$' + r.targetPrice : '—'}</td>
        <td class="small">${(r.specialRequirements || '—').slice(0, 55)}${(r.specialRequirements?.length ?? 0) > 55 ? '…' : ''}</td>
        <td><span style="background:${color}22;color:${color};padding:2px 7px;border-radius:3px;font-size:8px;font-weight:700">${r.status}</span></td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>rfq RFQ Report</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;direction:rtl;padding:14px;color:#1a1a2e}
    .header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #1a1a2e}
    .logo{font-size:17px;font-weight:800;letter-spacing:-.5px}.logo span{color:#38BDF8}
    .meta{font-size:9px;color:#666;margin-top:3px}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#1a1a2e;color:#fff}
    th{padding:6px 8px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right}
    td{padding:5px 8px;border-bottom:1px solid #e8eaf0;vertical-align:top}
    tr:nth-child(even):not([style]){background:#f9fafb}
    .mono{font-family:monospace;direction:ltr;text-align:left}
    .center{text-align:center}
    .small{font-size:9px;color:#555}
    .footer{margin-top:12px;font-size:8px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px}
    @media print{@page{size:A4 landscape;margin:8mm}body{padding:0}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">rfq <span>RFQ</span> REPORT</div>
      <div class="meta">${rfqs.length} פריטים | הופק: ${new Date().toLocaleString('he-IL')}</div>
    </div>
    <div class="meta" style="text-align:left">
      🔴 High &nbsp; 🟡 Medium &nbsp; 🟢 Low &nbsp; | &nbsp; <b style="color:#e65100">OBS</b> = Obsolete
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>שם לקוח</th><th>מק״ט יצרן</th><th>כמות</th><th>ת. אספקה</th>
        <th>תחליפי</th><th>מחיר מטרה</th><th>דרישות מיוחדות</th><th>סטטוס</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">rfq PROJECTS · Automated Procurement Pipeline · rfq-export-${new Date().toISOString().slice(0,10)}</div>
  <script>setTimeout(()=>window.print(),350)</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('אפשר חלונות popup בדפדפן זה כדי לייצא PDF');
    return;
  }
  win.document.write(html);
  win.document.close();
}
