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
  '\u00b7': '\\267',
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
    line(x1, y1, x2, y2, rgb, width = 0.6) {
      lines.push(`${rgb} RG`);
      lines.push(`${width} w`);
      lines.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    },
    text(font, size, x, y, value, rgb) {
      lines.push(`${rgb} rg`);
      lines.push('BT');
      lines.push(`/${font} ${size} Tf`);
      lines.push('0 Tc');
      lines.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
      lines.push(`(${pdfEscape(value)}) Tj`);
      lines.push('ET');
    },
    textSpaced(font, size, x, y, value, rgb, spacing) {
      lines.push(`${rgb} rg`);
      lines.push('BT');
      lines.push(`/${font} ${size} Tf`);
      lines.push(`${Number(spacing).toFixed(2)} Tc`);
      lines.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
      lines.push(`(${pdfEscape(value)}) Tj`);
      lines.push('0 Tc');
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

function recettesReportFileName(filter) {
  const from = pdfFileDate(filter.from);
  const to = pdfFileDate(filter.to);
  const reseller = pdfPlain(filter.reseller) || 'Tous les revendeurs';
  const router = pdfPlain(filter.router) || 'Tous les routeurs';
  const raw = `Recettes du ${from} au ${to} - ${reseller} - ${router}.pdf`;
  return raw.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pdfCash(value) {
  if (typeof money === 'function') return money(value || 0);
  return String(Math.round(Number(value) || 0));
}

function pdfPct(part, total) {
  const base = Number(total) || 0;
  const value = Number(part) || 0;
  if (!base) return '0 %';
  return `${Math.round((value * 100) / base)} %`;
}

function pdfTicketCount(count) {
  const total = Number(count) || 0;
  return `${total} ticket${total === 1 ? '' : 's'}`;
}

function pdfTodayLong() {
  const now = new Date();
  const month = PDF_MONTHS[now.getMonth()] || '';
  return `${now.getDate()} ${month} ${now.getFullYear()}`;
}

function pdfRecettesFrame(ops, pageNo, pageCount, filter) {
  const navy = '0.071 0.196 0.310';
  const ink = '0.102 0.153 0.200';
  const muted = '0.365 0.427 0.486';
  const green = '0.051 0.478 0.294';
  const due = '0.706 0.137 0.094';
  const line = '0.835 0.878 0.910';
  const gold = '0.910 0.784 0.486';
  const white = '1 1 1';
  const pale = '0.86 0.91 0.95';
  const headerH = 100;
  ops.fill(0, PDF_H - headerH, PDF_W, headerH, navy);
  ops.fill(0, PDF_H - headerH - 4, PDF_W, 4, green);
  ops.fill(0, PDF_H - headerH - 6.2, PDF_W, 2.2, gold);
  ops.textSpaced('F2', 8, 36, PDF_H - 26, 'HORIZON TEAM', gold, 1.15);
  ops.text('F2', 22, 36, PDF_H - 56, 'Recettes', white);
  ops.text('F1', 9, 36, PDF_H - 76, 'Synthèse des gains', pale);
  ops.textRight('F1', 8, PDF_W - 36, PDF_H - 30, 'Période', pale);
  ops.textRight('F2', 10, PDF_W - 36, PDF_H - 48, `Du ${pdfLongDate(filter.from)}`, white);
  ops.textRight('F2', 10, PDF_W - 36, PDF_H - 64, `au ${pdfLongDate(filter.to)}`, white);
  ops.textRight('F1', 8, PDF_W - 36, PDF_H - 82, `Établi le ${pdfTodayLong()}`, pale);
  ops.fill(0, 0, PDF_W, 6, navy);
  ops.fill(0, 6, PDF_W, 2, green);
  ops.line(36, 38, PDF_W - 36, 38, line, 0.5);
  const context = `${pdfPlain(filter.router) || 'Tous les routeurs'}   ·   ${pdfPlain(filter.reseller) || 'Tous les revendeurs'}`;
  ops.text('F1', 8, 36, 22, pdfFit(context, 390, 8), muted);
  ops.textRight('F1', 8, PDF_W - 36, 22, `Page ${pageNo} / ${pageCount}`, muted);
  return {
    top: PDF_H - headerH - 26,
    ink,
    muted,
    navy,
    green,
    due,
    line,
    white,
    gold,
    paper: '0.953 0.965 0.973',
    zebra: '0.965 0.973 0.980',
  };
}

function pdfRecettesMasthead(ops, y, period, colors) {
  const bandH = 82;
  const colW = (PDF_W - 72) / 3;
  const total = Number(period.total) || 0;
  const boxes = [
    ['Total ventes', pdfCash(period.total), pdfTicketCount(period.count), colors.navy],
    ['Parts revendeurs', pdfCash(period.resellerShare), pdfPct(period.resellerShare, total), colors.green],
    ['Part réseau', pdfCash(period.networkShare), pdfPct(period.networkShare, total), colors.due],
  ];
  ops.fill(36, y - bandH, PDF_W - 72, bandH, colors.paper);
  boxes.forEach((box, index) => {
    const x = 36 + index * colW;
    ops.fill(x, y - 3.5, colW, 3.5, box[3]);
    if (index) ops.line(x, y - 68, x, y - 16, colors.line, 0.6);
    ops.text('F1', 8, x + 12, y - 22, box[0], colors.muted);
    ops.text('F2', 12, x + 12, y - 44, pdfFit(box[1], colW - 22, 12), box[3]);
    ops.text('F1', 8, x + 12, y - 64, pdfFit(box[2], colW - 22, 8), colors.ink);
  });
  let next = y - bandH - 14;
  if (period.missingRate) {
    const note = `${period.missingRate} vente${period.missingRate > 1 ? 's' : ''} sans taux (${pdfCash(period.missingAmount || 0)})`;
    ops.fill(36, next - 16, PDF_W - 72, 20, '0.996 0.957 0.886');
    ops.fill(36, next - 16, 3, 20, '0.722 0.478 0.149');
    ops.text('F1', 8, 48, next - 10, pdfFit(note, PDF_W - 100, 8), '0.478 0.298 0.078');
    next -= 32;
  }
  return next;
}

function pdfRecettesSection(ops, y, num, title, colors) {
  ops.fill(36, y - 16, 20, 16, colors.navy);
  ops.text('F2', 8, 40.5, y - 11.5, num, colors.white);
  ops.text('F2', 12, 64, y - 13, title, colors.ink);
  const rule = 64 + title.length * 12 * 0.5 + 8;
  if (rule < PDF_W - 40) ops.line(rule, y - 8, PDF_W - 36, y - 8, colors.green, 1);
  return y - 30;
}

function pdfResellerColumns(ops, y, colors, filled) {
  const head = filled ? colors.navy : '0.886 0.918 0.941';
  const label = filled ? colors.white : colors.ink;
  ops.fill(36, y - 16, PDF_W - 72, 16, head);
  ops.text('F2', 7.5, 44, y - 11, 'Forfait', label);
  ops.text('F2', 7.5, 214, y - 11, 'Tkt', label);
  ops.textRight('F2', 7.5, 338, y - 11, 'Ventes', label);
  ops.textRight('F2', 7.5, 452, y - 11, 'Revendeur', label);
  ops.textRight('F2', 7.5, PDF_W - 44, y - 11, 'Réseau', label);
  return y - 16;
}

function pdfProfileColumns(ops, y, colors) {
  ops.fill(36, y - 18, PDF_W - 72, 18, colors.navy);
  ops.text('F2', 8, 44, y - 12, 'Forfait', colors.white);
  ops.text('F2', 8, 186, y - 12, 'Tickets', colors.white);
  ops.textRight('F2', 8, 300, y - 12, 'Ventes', colors.white);
  ops.textRight('F2', 8, 368, y - 12, 'Part du CA', colors.white);
  ops.textRight('F2', 8, 468, y - 12, 'Revendeurs', colors.white);
  ops.textRight('F2', 8, PDF_W - 44, y - 12, 'Réseau', colors.white);
  return y - 18;
}

function buildRecettesPdf(data, filter) {
  const safeFilter = {
    from: filter?.from || data?.period?.from || '',
    to: filter?.to || data?.period?.to || '',
    reseller: filter?.reseller || 'Tous les revendeurs',
    router: filter?.router || 'Tous les routeurs',
  };
  const period = data?.period || {
    count: 0,
    total: 0,
    resellerShare: 0,
    networkShare: 0,
    missingRate: 0,
    missingAmount: 0,
  };
  const resellers = Array.isArray(data?.byReseller) ? data.byReseller : [];
  const profiles = Array.isArray(data?.byProfile) ? data.byProfile : [];
  const pages = [];
  const bottom = 52;
  const top = PDF_H - 126;
  const openPage = () => {
    const page = { ops: pdfOps(), y: top };
    pages.push(page);
    return page;
  };
  const colors = {
    ink: '0.102 0.153 0.200',
    muted: '0.365 0.427 0.486',
    navy: '0.071 0.196 0.310',
    green: '0.051 0.478 0.294',
    due: '0.706 0.137 0.094',
    line: '0.835 0.878 0.910',
    white: '1 1 1',
    zebra: '0.965 0.973 0.980',
    paper: '0.953 0.965 0.973',
  };
  const ensure = (page, need) => (page.y - need < bottom ? openPage() : page);

  let page = openPage();
  page.y = pdfRecettesMasthead(page.ops, page.y, period, colors);
  if (data?.syncWarning) {
    page = ensure(page, 18);
    page.ops.text('F1', 8, 36, page.y - 4, pdfFit(data.syncWarning, PDF_W - 72, 8), colors.muted);
    page.y -= 16;
  }

  page = ensure(page, 120);
  page.y = pdfRecettesSection(page.ops, page.y, '01', 'Par revendeur', colors);
  if (!resellers.length) {
    page.ops.text('F1', 10, 36, page.y - 8, 'Aucune vente sur cette période.', colors.muted);
    page.y -= 28;
  }

  resellers.forEach((row) => {
    const profilesOf = Array.isArray(row.profiles) ? row.profiles : [];
    page = ensure(page, 78);
    const meta = [
      row.routerName || '—',
      row.rate == null ? 'taux manquant' : `taux ${row.rate} %`,
      pdfTicketCount(row.count),
    ].join('   ·   ');
    page.ops.fill(36, page.y - 12, 6, 6, colors.green);
    page.ops.text('F2', 11, 48, page.y - 12, pdfFit(row.name || 'Sans revendeur', 300, 11), colors.ink);
    page.ops.textRight('F2', 11, PDF_W - 36, page.y - 12, pdfFit(pdfCash(row.amount), 150, 11), colors.navy);
    page.ops.text('F1', 8, 48, page.y - 26, pdfFit(meta, 500, 8), colors.muted);
    page.ops.text('F1', 8, 48, page.y - 44, 'Part revendeur', colors.muted);
    page.ops.text('F2', 9, 128, page.y - 44, pdfFit(pdfCash(row.resellerShare), 130, 9), colors.green);
    page.ops.text('F1', 8, 290, page.y - 44, 'Part réseau', colors.muted);
    page.ops.text('F2', 9, 356, page.y - 44, pdfFit(pdfCash(row.networkShare), 140, 9), colors.due);
    page.y -= 52;
    if (row.missingRate) {
      page = ensure(page, 16);
      page.ops.text('F1', 8, 48, page.y - 2, 'Taux manquant sur une partie des ventes.', colors.due);
      page.y -= 14;
    }
    if (!profilesOf.length) {
      page.ops.line(36, page.y - 2, PDF_W - 36, page.y - 2, colors.line, 0.6);
      page.y -= 16;
      return;
    }
    page.y -= 4;
    const drawRows = (start, suite) => {
      if (page.y - 40 < bottom) page = openPage();
      if (suite) {
        page.ops.text('F2', 9, 36, page.y - 10, pdfFit(`${row.name || 'Sans revendeur'} · suite`, 420, 9), colors.ink);
        page.y -= 16;
      }
      page.y = pdfResellerColumns(page.ops, page.y, colors, false);
      let index = start;
      while (index < profilesOf.length) {
        if (page.y - 15 < bottom) break;
        const item = profilesOf[index];
        const rowTop = page.y;
        if (index % 2 === 0) page.ops.fill(36, rowTop - 15, PDF_W - 72, 15, colors.zebra);
        page.ops.text('F1', 8, 44, rowTop - 11, pdfFit(item.profile || '—', 156, 8), colors.ink);
        page.ops.text('F1', 8, 214, rowTop - 11, String(item.count || 0), colors.ink);
        page.ops.textRight('F2', 8, 338, rowTop - 11, pdfFit(pdfCash(item.amount), 90, 8), colors.ink);
        page.ops.textRight('F1', 8, 452, rowTop - 11, pdfFit(pdfCash(item.resellerShare), 100, 8), colors.green);
        page.ops.textRight('F1', 8, PDF_W - 44, rowTop - 11, pdfFit(pdfCash(item.networkShare), 90, 8), colors.due);
        page.y = rowTop - 15;
        index += 1;
      }
      return index;
    };
    let cursor = drawRows(0, page.y - 40 < bottom);
    while (cursor < profilesOf.length) cursor = drawRows(cursor, true);
    page.ops.line(36, page.y, PDF_W - 36, page.y, colors.line, 0.7);
    page.y -= 18;
  });

  page = ensure(page, 140);
  page.y = pdfRecettesSection(page.ops, page.y, '02', 'Par forfait', colors);
  if (!profiles.length) {
    page.ops.text('F1', 10, 36, page.y - 8, 'Aucune vente sur cette période.', colors.muted);
    page.y -= 24;
  } else {
    const drawProfileHead = (continued) => {
      page = ensure(page, 40);
      if (continued) {
        page.ops.text('F2', 9, 36, page.y - 10, 'Par forfait · suite', colors.ink);
        page.y -= 16;
      }
      page.y = pdfProfileColumns(page.ops, page.y, colors);
    };
    drawProfileHead(false);
    profiles.forEach((row, index) => {
      if (page.y - 18 < bottom) drawProfileHead(true);
      const rowTop = page.y;
      if (index % 2 === 0) page.ops.fill(36, rowTop - 17, PDF_W - 72, 17, colors.zebra);
      page.ops.text('F1', 8, 44, rowTop - 12, pdfFit(row.profile || '—', 130, 8), colors.ink);
      page.ops.text('F1', 8, 186, rowTop - 12, String(row.count || 0), colors.ink);
      page.ops.textRight('F2', 8, 300, rowTop - 12, pdfFit(pdfCash(row.amount), 90, 8), colors.ink);
      page.ops.textRight('F1', 8, 368, rowTop - 12, pdfPct(row.amount, period.total), colors.muted);
      page.ops.textRight('F1', 8, 468, rowTop - 12, pdfFit(pdfCash(row.resellerShare), 90, 8), colors.green);
      page.ops.textRight('F1', 8, PDF_W - 44, rowTop - 12, pdfFit(pdfCash(row.networkShare), 80, 8), colors.due);
      page.y = rowTop - 17;
    });
    if (page.y - 20 < bottom) drawProfileHead(true);
    page.ops.fill(36, page.y - 18, PDF_W - 72, 18, colors.navy);
    page.ops.text('F2', 8, 44, page.y - 12, 'Total', colors.white);
    page.ops.text('F2', 8, 186, page.y - 12, String(period.count || 0), colors.white);
    page.ops.textRight('F2', 8, 300, page.y - 12, pdfFit(pdfCash(period.total), 90, 8), colors.white);
    page.ops.textRight('F2', 8, 368, page.y - 12, '100 %', colors.white);
    page.ops.textRight('F2', 8, 468, page.y - 12, pdfFit(pdfCash(period.resellerShare), 90, 8), colors.white);
    page.ops.textRight('F2', 8, PDF_W - 44, page.y - 12, pdfFit(pdfCash(period.networkShare), 80, 8), colors.white);
  }

  const contents = pages.map((item, index) => {
    const framed = pdfOps();
    pdfRecettesFrame(framed, index + 1, pages.length, safeFilter);
    return `${framed.join()}\n${item.ops.join()}`;
  });
  return pdfDocument(contents);
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
