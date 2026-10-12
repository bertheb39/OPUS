const PDF_W = 595.28;
const PDF_H = 841.89;
const PDF_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const PDF_WIN = {
  '\u00e0': '\\340', '\u00e2': '\\342', '\u00e4': '\\344',
  '\u00e7': '\\347',
  '\u00e8': '\\350', '\u00e9': '\\351', '\u00ea': '\\352', '\u00eb': '\\353',
  '\u00ee': '\\356', '\u00ef': '\\357',
  '\u00f4': '\\364', '\u00f6': '\\366',
  '\u00f9': '\\371', '\u00fb': '\\373', '\u00fc': '\\374',
  '\u00c0': '\\300', '\u00c2': '\\302', '\u00c4': '\\304',
  '\u00c7': '\\307',
  '\u00c8': '\\310', '\u00c9': '\\311', '\u00ca': '\\312', '\u00cb': '\\313',
  '\u00ce': '\\316', '\u00cf': '\\317',
  '\u00d4': '\\324', '\u00d6': '\\326',
  '\u00d9': '\\331', '\u00db': '\\333', '\u00dc': '\\334',
};

function pdfPlain(value) {
  return String(value ?? '')
    .replace(/\u202f|\u00a0|\u2009/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[«»]/g, '"')
    .replace(/\u20ac/g, 'EUR')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value) {
  let out = '';
  for (const ch of pdfPlain(value)) {
    if (PDF_WIN[ch]) out += PDF_WIN[ch];
    else if (ch === '\\') out += '\\\\';
    else if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (ch >= ' ' && ch <= '~') out += ch;
    else out += '?';
  }
  return out;
}

function pdfFit(value, width, size) {
  const text = pdfPlain(value);
  const max = Math.max(4, Math.floor(width / (size * 0.5)));
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function pdfDateParts(iso) {
  const match = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: match[1], month: Number(match[2]), day: match[3] };
}

function pdfLongDate(iso) {
  const parts = pdfDateParts(iso);
  if (!parts || parts.month < 1 || parts.month > 12) return pdfPlain(iso);
  return `${Number(parts.day)} ${PDF_MONTHS[parts.month - 1]} ${parts.year}`;
}

function pdfFileDate(iso) {
  const parts = pdfDateParts(iso);
  if (!parts) return 'date';
  return `${parts.day}-${String(parts.month).padStart(2, '0')}-${parts.year}`;
}

function salesReportFileName(filter) {
  const from = pdfFileDate(filter.from);
  const to = pdfFileDate(filter.to);
  const reseller = pdfPlain(filter.reseller) || 'Tous les revendeurs';
  const router = pdfPlain(filter.router) || 'Tous les routeurs';
  const raw = `Rapport du ${from} au ${to} - ${reseller} - ${router}.pdf`;
  return raw.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pdfOps() {
  const lines = [];
  return {
    lines,
    fill(x, y, w, h, rgb) {
      lines.push(`${rgb} rg`);
      lines.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    },
    stroke(x, y, w, h, rgb) {
      lines.push(`${rgb} RG`);
      lines.push('0.6 w');
      lines.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    },
    text(font, size, x, y, value, rgb) {
      lines.push(`${rgb} rg`);
      lines.push('BT');
      lines.push(`/${font} ${size} Tf`);
      lines.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
      lines.push(`(${pdfEscape(value)}) Tj`);
      lines.push('ET');
    },
    textRight(font, size, right, y, value, rgb) {
      const text = pdfPlain(value);
      const width = text.length * size * 0.5;
      this.text(font, size, right - width, y, text, rgb);
    },
    join() {
      return lines.join('\n');
    },
  };
}

function pdfPageFrame(ops, pageNo, pageCount, filter) {
  const navy = '0.071 0.196 0.310';
  const ink = '0.102 0.153 0.200';
  const muted = '0.365 0.427 0.486';
  const white = '1 1 1';
  const green = '0.051 0.478 0.294';
  ops.fill(0, PDF_H - 78, PDF_W, 78, navy);
  ops.fill(0, PDF_H - 82, PDF_W, 4, green);
  ops.text('F2', 11, 36, PDF_H - 28, 'HORIZON TEAM', white);
  ops.text('F2', 18, 36, PDF_H - 50, 'Rapport des ventes', white);
  ops.text('F1', 9, 36, PDF_H - 66, `Du ${pdfLongDate(filter.from)} au ${pdfLongDate(filter.to)}`, '0.86 0.91 0.95');
  ops.text('F1', 9, 36, 28, `${pdfPlain(filter.router)}  ·  ${pdfPlain(filter.reseller)}`, muted);
  ops.textRight('F1', 9, PDF_W - 36, 28, `Page ${pageNo} / ${pageCount}`, muted);
  ops.fill(36, 42, PDF_W - 72, 0.6, '0.835 0.878 0.910');
  return { top: PDF_H - 104, ink, muted, navy, green };
}

function pdfSummary(ops, y, sales, colors) {
  const period = sales.period || { count: 0, amount: 0, from: '', to: '' };
  const settlement = sales.settlement || {};
  const pending = sales.pending || { count: 0, amount: 0 };
  const boxes = [
    ['Comptabilisé', typeof money === 'function' ? money(period.amount || 0) : String(period.amount || 0), `${period.count || 0} ticket${period.count === 1 ? '' : 's'}`],
    ['Part revendeur', settlement.resellerShare == null ? '—' : (typeof money === 'function' ? money(settlement.resellerShare) : String(settlement.resellerShare)), settlement.resellerName || ''],
    ['Part réseau', settlement.networkShare == null ? '—' : (typeof money === 'function' ? money(settlement.networkShare) : String(settlement.networkShare)), settlement.networkName || ''],
  ];
  const gap = 8;
  const boxW = (PDF_W - 72 - gap * 2) / 3;
  const boxH = 58;
  boxes.forEach((box, index) => {
    const x = 36 + index * (boxW + gap);
    ops.fill(x, y - boxH, boxW, boxH, index === 0 ? '0.953 0.965 0.973' : (index === 1 ? '0.925 0.965 0.941' : '0.984 0.945 0.945'));
    ops.text('F1', 8, x + 8, y - 16, box[0], colors.muted);
    ops.text('F2', 11, x + 8, y - 34, pdfFit(box[1], boxW - 16, 11), colors.ink);
    if (box[2]) ops.text('F1', 8, x + 8, y - 48, pdfFit(box[2], boxW - 16, 8), colors.muted);
  });
  let next = y - boxH - 16;
  const rate = settlement.rate == null ? '' : `Taux à reverser : ${settlement.rate} %`;
  const wait = `Remis en attente : ${pending.count || 0} ticket${(pending.count || 0) === 1 ? '' : 's'} · ${typeof money === 'function' ? money(pending.amount || 0) : (pending.amount || 0)}`;
  ops.text('F1', 9, 36, next, [rate, wait].filter(Boolean).join('     '), colors.ink);
  if (settlement.missingRate) {
    next -= 14;
    ops.text('F1', 9, 36, next, 'Taux manquant sur un ou plusieurs revendeurs.', '0.616 0.173 0.173');
  }
  return next - 22;
}

function pdfTableHead(ops, y) {
  const head = '0.071 0.196 0.310';
  ops.fill(36, y - 16, PDF_W - 72, 20, head);
  const cols = [44, 118, 210, 330, 470];
  const labels = ['Date', 'Code', 'Revendeur', 'Forfait', 'Montant'];
  labels.forEach((label, index) => {
    if (index === labels.length - 1) ops.textRight('F2', 8, PDF_W - 44, y - 10, label, '1 1 1');
    else ops.text('F2', 8, cols[index], y - 10, label, '1 1 1');
  });
  return y - 20;
}

function buildSalesReportPdf(sales, filter) {
  const rows = Array.isArray(sales?.sales) ? sales.sales : [];
  const shown = rows.length;
  const total = Number(sales?.period?.count) || shown;
  const colors = { ink: '0.102 0.153 0.200', muted: '0.365 0.427 0.486' };
  const pages = [];
  const openPage = (withSummary) => {
    const ops = pdfOps();
    const page = { ops, y: PDF_H - 104 };
    pages.push(page);
    if (withSummary) page.y = pdfSummary(ops, page.y, sales, colors);
    page.y = pdfTableHead(ops, page.y);
    return page;
  };
  let page = openPage(true);
  if (!shown) {
    page.ops.text('F1', 10, 44, page.y - 22, 'Aucune connexion sur cette période.', colors.muted);
  }
  rows.forEach((sale, index) => {
    if (page.y < 78) page = openPage(false);
    const y = page.y;
    if (index % 2 === 0) page.ops.fill(36, y - 18, PDF_W - 72, 18, '0.965 0.973 0.980');
    page.ops.text('F1', 8, 44, y - 13, pdfFit(sale.date || sale.when || '', 68, 8), colors.ink);
    page.ops.text('F2', 8, 118, y - 13, pdfFit(sale.code || '', 84, 8), colors.ink);
    page.ops.text('F1', 8, 210, y - 13, pdfFit(sale.reseller || sale.keyword || '—', 112, 8), colors.ink);
    page.ops.text('F1', 8, 330, y - 13, pdfFit(sale.profile || '—', 120, 8), colors.ink);
    const amount = typeof money === 'function' ? money(sale.price ?? 0) : String(sale.price ?? 0);
    page.ops.textRight('F2', 8, PDF_W - 44, y - 13, pdfFit(amount, 78, 8), colors.ink);
    page.y = y - 18;
  });
  if (total > shown) {
    if (page.y < 70) page = openPage(false);
    page.ops.text('F1', 8, 44, page.y - 8, `Détail limité aux ${shown} premières connexions sur ${total}.`, colors.muted);
  }
  const contents = pages.map((item, index) => {
    const framed = pdfOps();
    pdfPageFrame(framed, index + 1, pages.length, filter);
    return `${framed.join()}\n${item.ops.join()}`;
  });
  return pdfDocument(contents);
}

function pdfDocument(contents) {
  const objects = [];
  const chunks = ['%PDF-1.4\n'];
  let length = chunks[0].length;
  const offsets = [0];
  const add = (body) => {
    const id = offsets.length;
    offsets.push(length);
    const chunk = `${id} 0 obj\n${body}\nendobj\n`;
    chunks.push(chunk);
    length += chunk.length;
    objects.push(id);
    return id;
  };
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  const contentIds = contents.map((content) => {
    const data = content.endsWith('\n') ? content : `${content}\n`;
    return add(`<< /Length ${data.length} >>\nstream\n${data}endstream`);
  });
  const pagesIdSlot = objects.length + 1 + contentIds.length;
  contentIds.forEach((contentId) => {
    const pageId = add(`<< /Type /Page /Parent ${pagesIdSlot} 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  const pagesId = add(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  if (pagesId !== pagesIdSlot) {
    throw new Error('PDF impossible.');
  }
  let xref = `xref\n0 ${offsets.length}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${offsets.length} /Root ${catalogId} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  const pdf = `${chunks.join('')}${xref}${trailer}`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}

function pdfBase64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function saveReportPdf(bytes, fileName) {
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RouterOs;
  if (plugin && plugin.shareFile) {
    await plugin.shareFile({
      base64: pdfBase64(bytes),
      name: fileName,
      mime: 'application/pdf',
    });
    return;
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}
