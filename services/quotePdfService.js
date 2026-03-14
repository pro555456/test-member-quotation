const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const puppeteer = require('puppeteer-core');

const mySqlDb = require('../connection/mySqlConnection');
const { getRuntimeConfig } = require('../config/env');
const { getBrandingConfig } = require('../config/branding');
const { HttpError } = require('../utils/http');

const LABELS = {
  gameTest: '\u904a\u6232\u6aa2\u6e2c',
  appService: 'APP\u6aa2\u6e2c\u670d\u52d9',
  formalQuotation: '\u6b63\u5f0f\u5831\u50f9\u55ae',
  customerCompany: '\u5ba2\u6236\u516c\u53f8\u540d\u7a31',
  contactName: '\u806f\u7d61\u4eba',
  contactEmail: '\u5ba2\u6236 Email',
  contactPhone: '\u806f\u7d61\u96fb\u8a71',
  quotationNo: '\u5831\u50f9\u55ae\u7de8\u865f',
  quoteDate: '\u5831\u50f9\u65e5\u671f',
  quotationSection: '\u5831\u50f9\u55ae',
  itemName: '\u9805\u76ee\u540d\u7a31',
  itemSpec: '\u9805\u76ee\u540d\u7a31\u8207\u898f\u683c',
  quantity: '\u6578\u91cf',
  unitPrice: '\u55ae\u50f9',
  subtotal: '\u5c0f\u8a08',
  untaxed: '\u672a\u7a05\u91d1\u984d',
  tax: '\u7a05\u984d 5%',
  total: '\u542b\u7a05\u7e3d\u8a08',
  notes: '\u5099\u8a3b\u8aaa\u660e',
  paymentInfo: '\u4ed8\u6b3e\u8cc7\u8a0a',
  terms: '\u689d\u6b3e\u8207\u6ce8\u610f\u4e8b\u9805',
  companyApproval: '\u516c\u53f8\u7c3d\u540d\u84cb\u7ae0',
  customerApproval: '\u5ba2\u6236\u7c3d\u540d\u84cb\u7ae0',
  taxId: '\u7d71\u7de8',
  address: '\u5730\u5740',
  phone: '\u96fb\u8a71',
  website: '\u7db2\u7ad9',
  iosPlatform: '\u5e73\u53f0\uff1aiOS',
  androidPlatform: '\u5e73\u53f0\uff1aAndroid',
  webPlatform: '\u5e73\u53f0\uff1aWeb',
  otherPlatform: '\u5e73\u53f0\uff1aOther',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function formatMoney(value) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function sanitizeFilePart(value) {
  return String(value || 'quote').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'quote';
}

async function pathExists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileToDataUri(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.svg'
    ? 'image/svg+xml'
    : ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : 'application/octet-stream';
  const buffer = await fsPromises.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function resolveChromeExecutable() {
  const runtime = getRuntimeConfig();
  const candidates = [
    runtime.quotePdfChromePath,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildLineItems(quote) {
  const quantity = Number(quote.quantity || 1);
  const gameTitle = quote.gameTitle || LABELS.gameTest;
  const serviceName = quote.serviceName || LABELS.appService;
  const breakdown = quote.pricingBreakdown || {};

  const lines = [
    quote.platforms?.ios ? {
      itemName: gameTitle,
      specification: `${serviceName}(${LABELS.iosPlatform})`,
      quantity,
      unitPrice: Number(breakdown.ios || 0),
      lineTotal: Number(breakdown.ios || 0) * quantity,
    } : null,
    quote.platforms?.android ? {
      itemName: gameTitle,
      specification: `${serviceName}(${LABELS.androidPlatform})`,
      quantity,
      unitPrice: Number(breakdown.android || 0),
      lineTotal: Number(breakdown.android || 0) * quantity,
    } : null,
    quote.platforms?.web ? {
      itemName: gameTitle,
      specification: `${serviceName}(${LABELS.webPlatform})`,
      quantity,
      unitPrice: Number(breakdown.web || 0),
      lineTotal: Number(breakdown.web || 0) * quantity,
    } : null,
    quote.platforms?.other ? {
      itemName: gameTitle,
      specification: `${breakdown.otherItemLabel || '\u81ea\u8a02\u9805\u76ee'}`,
      quantity,
      unitPrice: Number(breakdown.other || 0),
      lineTotal: Number(breakdown.other || 0) * quantity,
    } : null,
  ].filter(Boolean);

  return lines.length ? lines : [{
    itemName: gameTitle,
    specification: serviceName,
    quantity,
    unitPrice: Number(quote.unitPriceUntaxed || 0),
    lineTotal: Number(quote.totalUntaxed || 0),
  }];
}

async function buildPdfHtml(quote) {
  const branding = {
    ...getBrandingConfig(),
    ...(quote.companyBranding || {}),
  };
  const quoteNumber = quote.quotationNo || quote.quoteNo || quote.internalOrderNo || `QUOTE-${quote.id}`;
  const lineItems = buildLineItems(quote)
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.itemName)}</td>
        <td>${escapeHtml(item.specification)}</td>
        <td class="text-center">${escapeHtml(item.quantity)}</td>
        <td class="text-right">${escapeHtml(formatMoney(item.unitPrice))}</td>
        <td class="text-right">${escapeHtml(formatMoney(item.lineTotal))}</td>
      </tr>
    `)
    .join('');
  const terms = branding.quotationTerms || [];
  const pdfContactName = quote.pdfContactName || '\u2014';
  const pdfContactEmail = quote.pdfContactEmail || '\u2014';

  return `<!doctype html>
  <html lang="zh-Hant">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(quoteNumber)}</title>
      <style>
        @page {
          size: A4;
          margin: 2.54cm 1.91cm;
        }
        body {
          margin: 0;
          color: #1f2940;
          font-family: "Microsoft JhengHei", "PingFang TC", sans-serif;
          font-size: 12px;
          line-height: 1.42;
        }
        .sheet {
          width: 100%;
          min-height: calc(297mm - 5.08cm);
          display: flex;
          flex-direction: column;
        }
        .header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 285px;
          gap: 14px;
          align-items: start;
          border-bottom: 1px solid #cbd4e3;
          padding-bottom: 10px;
        }
        .brand {
          display: block;
        }
        .brand-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          width: 430px;
        }
        .brand-zh {
          color: #101750;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 2px;
          line-height: 1.15;
          white-space: nowrap;
        }
        .brand-en {
          margin-top: 3px;
          color: #4f5f7f;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.28px;
          line-height: 1.15;
          white-space: nowrap;
        }
        .doc-title {
          margin: 12px 0 8px;
          text-align: center;
          color: #101750;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 3px;
        }
        .company-meta {
          width: 100%;
          text-align: right;
          font-size: 11px;
          line-height: 1.48;
          color: #4d5d7a;
          padding-top: 2px;
        }
        .company-meta-row {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          white-space: nowrap;
        }
        .company-meta-label {
          color: #101750;
          font-weight: 700;
        }
        .section {
          margin-top: 10px;
        }
        .footer-stack {
          margin-top: auto;
        }
        .section-title {
          margin: 0 0 6px;
          color: #101750;
          font-size: 14px;
          font-weight: 700;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          padding: 8px 10px;
          border: 1px solid #d8dfeb;
        }
        .info-column {
          min-width: 0;
        }
        .info-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 5px;
        }
        .info-row:last-child {
          margin-bottom: 0;
        }
        .meta-label {
          color: #5f6f8a;
          min-width: 72px;
        }
        .meta-value {
          font-weight: 600;
          flex: 1;
          min-width: 0;
        }
        .info-column.right .meta-value {
          text-align: left;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          border: 1px solid #d8dfeb;
          padding: 7px 8px;
          vertical-align: top;
        }
        th {
          background: #f5f7fb;
          color: #4e5d78;
          font-weight: 700;
        }
        .text-center {
          text-align: center;
        }
        .text-right {
          text-align: right;
        }
        .summary {
          width: 300px;
          margin-left: auto;
          margin-top: 6px;
          border: 1px solid #d8dfeb;
          padding: 8px 10px;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 3px 0;
        }
        .summary-row.total {
          border-top: 1px solid #d8dfeb;
          margin-top: 3px;
          padding-top: 6px;
          font-weight: 700;
          color: #101750;
        }
        .payment-box, .terms-box {
          border: 1px solid #d8dfeb;
          padding: 10px 12px;
        }
        .payment-line {
          font-weight: 600;
        }
        .terms-list {
          margin: 0;
          padding-left: 18px;
        }
        .terms-list li {
          margin-bottom: 4px;
        }
        .signature-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-top: 12px;
        }
        .signature-box {
          border: 1px solid #d8dfeb;
          padding: 10px 12px;
          min-height: 112px;
        }
        .signature-title {
          margin-bottom: 10px;
          color: #101750;
          font-weight: 700;
        }
        .signature-space {
          height: 68px;
          border: 1px dashed #c4cede;
          border-radius: 4px;
          background: #fbfcfe;
        }
      </style>
    </head>
    <body>
      <div class="sheet">
        <section class="header">
          <div class="brand">
            <div class="brand-copy">
              <div class="brand-zh">${escapeHtml(branding.companyNameZh)}</div>
              <div class="brand-en">${escapeHtml(branding.companyNameEn || branding.brandName)}</div>
            </div>
          </div>
          <div class="company-meta">
            <div class="company-meta-row"><span class="company-meta-label">${LABELS.taxId}\uff1a</span><span>${escapeHtml(branding.taxId || '\u2014')}</span></div>
            <div class="company-meta-row"><span class="company-meta-label">${LABELS.address}\uff1a</span><span>${escapeHtml(branding.address || '\u2014')}</span></div>
            <div class="company-meta-row"><span class="company-meta-label">${LABELS.website}\uff1a</span><span>${escapeHtml(branding.website || '\u2014')}</span></div>
          </div>
        </section>

        <div class="doc-title">${LABELS.quotationSection}</div>

        <section class="section">
          <div class="info-grid">
            <div class="info-column">
              <div class="info-row"><span class="meta-label">\u5ba2\u6236\u540d\u7a31\uff1a</span><span class="meta-value">${escapeHtml(quote.customerName || '\u2014')}</span></div>
              <div class="info-row"><span class="meta-label">\u806f\u7d61\u4eba\uff1a</span><span class="meta-value">${escapeHtml(quote.customerContactName || '\u2014')}</span></div>
              <div class="info-row"><span class="meta-label">\u96fb\u8a71\uff1a</span><span class="meta-value">${escapeHtml(quote.customerContactPhone || '\u2014')}</span></div>
              <div class="info-row"><span class="meta-label">\u96fb\u90f5\uff1a</span><span class="meta-value">${escapeHtml(quote.customerContactEmail || '\u2014')}</span></div>
            </div>
            <div class="info-column right">
              <div class="info-row"><span class="meta-label">${LABELS.quotationNo}\uff1a</span><span class="meta-value">${escapeHtml(quoteNumber)}</span></div>
              <div class="info-row"><span class="meta-label">${LABELS.quoteDate}\uff1a</span><span class="meta-value">${escapeHtml(quote.quoteDate || '\u2014')}</span></div>
              <div class="info-row"><span class="meta-label">\u806f\u7d61\u4eba\uff1a</span><span class="meta-value">${escapeHtml(pdfContactName)}</span></div>
              <div class="info-row"><span class="meta-label">\u96fb\u90f5\uff1a</span><span class="meta-value">${escapeHtml(pdfContactEmail)}</span></div>
            </div>
          </div>
        </section>

        <section class="section">
          <table>
            <thead>
              <tr>
                <th style="width:22%;">${LABELS.itemName}</th>
                <th>${LABELS.itemSpec}</th>
                <th class="text-center" style="width:10%;">${LABELS.quantity}</th>
                <th class="text-right" style="width:18%;">${LABELS.unitPrice}</th>
                <th class="text-right" style="width:18%;">${LABELS.subtotal}</th>
              </tr>
            </thead>
            <tbody>
              ${lineItems}
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-row"><span>${LABELS.untaxed}</span><strong>${escapeHtml(formatMoney(quote.totalUntaxed || 0))}</strong></div>
            <div class="summary-row"><span>${LABELS.tax}</span><strong>${escapeHtml(formatMoney(quote.taxAmount || 0))}</strong></div>
            <div class="summary-row total"><span>${LABELS.total}</span><strong>${escapeHtml(formatMoney(quote.totalAmount || quote.totalUntaxed || 0))}</strong></div>
          </div>
        </section>

        <div class="footer-stack">
          <section class="section">
            <div class="payment-box">
              <h2 class="section-title">${LABELS.paymentInfo}</h2>
              <div class="payment-line">
                ${escapeHtml(branding.bank.accountName)} / ${escapeHtml(branding.bank.bankName)} / ${escapeHtml(branding.bank.accountNo)}
              </div>
            </div>
          </section>

          <section class="section">
            <div class="terms-box">
              <h2 class="section-title">${LABELS.terms}</h2>
              <ol class="terms-list">
                ${terms.map((term) => `<li>${escapeHtml(term).replace(/\n/g, '<br>')}</li>`).join('')}
              </ol>
            </div>
          </section>

          <section class="signature-grid">
            <div class="signature-box">
              <div class="signature-title">${LABELS.companyApproval}</div>
              <div class="signature-space"></div>
            </div>
            <div class="signature-box">
              <div class="signature-title">${LABELS.customerApproval}</div>
              <div class="signature-space"></div>
            </div>
          </section>
        </div>
      </div>
    </body>
  </html>`;
}

async function renderQuotePdfBuffer(quote) {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new HttpError(500, 'Chrome or Edge executable not found for PDF generation', 'PDF_CHROME_NOT_FOUND');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(await buildPdfHtml(quote), { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '25.4mm', right: '19.1mm', bottom: '25.4mm', left: '19.1mm' },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

async function persistQuotePdf(quote, { userId = null, db = mySqlDb } = {}) {
  const runtime = getRuntimeConfig();
  const storageDir = runtime.quotePdfStoragePath;
  await fsPromises.mkdir(storageDir, { recursive: true });

  const pdfBuffer = await renderQuotePdfBuffer(quote);
  const safeName = sanitizeFilePart(quote.quotationNo || quote.internalOrderNo || quote.quoteNo || `quote-${quote.id}`);
  const fileName = `${safeName}.pdf`;
  const filePath = path.join(storageDir, fileName);
  await fsPromises.writeFile(filePath, pdfBuffer);

  const existing = await db.queryOne(
    "SELECT * FROM quote_attachments WHERE quote_id = ? AND attachment_kind = 'quote_pdf' LIMIT 1",
    [quote.id]
  );

  let attachmentId = existing?.id ? Number(existing.id) : null;

  if (existing?.file_path && existing.file_path !== filePath && await pathExists(existing.file_path)) {
    await fsPromises.unlink(existing.file_path).catch(() => {});
  }

  if (attachmentId) {
    await db.query(
      `UPDATE quote_attachments
       SET file_name = ?, file_path = ?, mime_type = ?, attachment_kind = 'quote_pdf', file_size = ?, uploaded_by = ?, uploaded_at = NOW()
       WHERE id = ?`,
      [fileName, filePath, 'application/pdf', pdfBuffer.length, userId, attachmentId]
    );
  } else {
    const result = await db.query(
      `INSERT INTO quote_attachments (
        quote_id, file_name, file_path, mime_type, attachment_kind, file_size, uploaded_by, uploaded_at
      ) VALUES (?, ?, ?, ?, 'quote_pdf', ?, ?, NOW())`,
      [quote.id, fileName, filePath, 'application/pdf', pdfBuffer.length, userId]
    );
    attachmentId = Number(result.insertId);
  }

  await db.query('UPDATE quotes SET pdf_attachment_id = ? WHERE id = ?', [attachmentId, quote.id]);

  return {
    id: attachmentId,
    quoteId: quote.id,
    fileName,
    filePath,
    mimeType: 'application/pdf',
    fileSize: pdfBuffer.length,
    buffer: pdfBuffer,
  };
}

module.exports = {
  buildPdfHtml,
  renderQuotePdfBuffer,
  persistQuotePdf,
};
