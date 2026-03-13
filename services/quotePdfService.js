const fs = require('fs/promises');
const path = require('path');

const puppeteer = require('puppeteer-core');

const mySqlDb = require('../connection/mySqlConnection');
const { getRuntimeConfig } = require('../config/env');
const { HttpError } = require('../utils/http');

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
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveChromeExecutable() {
  const runtime = getRuntimeConfig();
  const candidates = [
    runtime.quotePdfChromePath,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  return candidates.find((candidate) => require('fs').existsSync(candidate)) || null;
}

function buildPdfHtml(quote) {
  const pricing = quote.pricingBreakdown || {};
  const platformRows = [
    ['iOS', pricing.ios],
    ['Android', pricing.android],
    ['Web', pricing.web],
    [pricing.otherItemLabel || 'Other', pricing.other],
  ].filter(([, amount]) => Number(amount || 0) > 0);

  const platforms = Object.entries(quote.platforms || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name.toUpperCase())
    .join(' / ');

  const lineItems = platformRows.map(([label, amount]) => `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td class="text-right">${escapeHtml(formatMoney(amount))}</td>
    </tr>
  `).join('');

  return `<!doctype html>
  <html lang="zh-Hant">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(quote.internalOrderNo || quote.quoteNo || `Quote-${quote.id}`)}</title>
      <style>
        body {
          font-family: 'Microsoft JhengHei', 'PingFang TC', sans-serif;
          margin: 0;
          color: #12343b;
          background: #f5f2ea;
        }
        .page {
          padding: 48px;
        }
        .hero {
          background: linear-gradient(135deg, #0f5b63, #1d7c74);
          color: #fff;
          border-radius: 24px;
          padding: 32px;
          margin-bottom: 28px;
        }
        .hero h1 {
          margin: 0 0 8px;
          font-size: 30px;
          letter-spacing: 2px;
        }
        .hero p {
          margin: 0;
          color: rgba(255,255,255,0.82);
          font-size: 13px;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          margin-bottom: 28px;
        }
        .card {
          background: #fff;
          border-radius: 18px;
          padding: 20px 24px;
          box-shadow: 0 18px 40px rgba(18, 52, 59, 0.08);
        }
        .card h2 {
          margin: 0 0 12px;
          font-size: 14px;
          letter-spacing: 1.5px;
          color: #78939b;
          text-transform: uppercase;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 8px 0;
          border-bottom: 1px solid #edf2f2;
          font-size: 14px;
        }
        .meta-row:last-child {
          border-bottom: none;
        }
        .meta-label {
          color: #6f7f84;
        }
        .meta-value {
          font-weight: 600;
          text-align: right;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          padding: 12px 0;
          border-bottom: 1px solid #edf2f2;
          font-size: 14px;
        }
        th {
          color: #6f7f84;
          text-align: left;
        }
        .text-right {
          text-align: right;
        }
        .summary {
          margin-top: 16px;
          background: #f5faf9;
          border-radius: 16px;
          padding: 16px 18px;
        }
        .summary strong {
          display: block;
          font-size: 24px;
          margin-top: 4px;
          color: #0f5b63;
        }
        .notes {
          white-space: pre-wrap;
          line-height: 1.8;
        }
        .footer {
          margin-top: 32px;
          font-size: 12px;
          color: #6f7f84;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <section class="hero">
          <p>Game QA Hub</p>
          <h1>遊戲檢測報價單</h1>
          <p>報價編號 ${escapeHtml(quote.quoteNo || '—')} / 內部單號 ${escapeHtml(quote.internalOrderNo || '—')}</p>
        </section>

        <section class="grid">
          <div class="card">
            <h2>客戶資訊</h2>
            <div class="meta-row"><span class="meta-label">客戶名稱</span><span class="meta-value">${escapeHtml(quote.customerName || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">聯絡人</span><span class="meta-value">${escapeHtml(quote.customerContactName || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">Email</span><span class="meta-value">${escapeHtml(quote.customerContactEmail || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">客戶訂單編號</span><span class="meta-value">${escapeHtml(quote.customerOrderNo || '—')}</span></div>
          </div>
          <div class="card">
            <h2>報價資訊</h2>
            <div class="meta-row"><span class="meta-label">報價日期</span><span class="meta-value">${escapeHtml(quote.quoteDate || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">遊戲 / 檢測內容</span><span class="meta-value">${escapeHtml(quote.gameTitle || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">檢測平台</span><span class="meta-value">${escapeHtml(platforms || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">數量</span><span class="meta-value">${escapeHtml(quote.quantity || 1)}</span></div>
          </div>
        </section>

        <section class="card">
          <h2>平台與金額</h2>
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th class="text-right">未稅單價</th>
              </tr>
            </thead>
            <tbody>
              ${lineItems || '<tr><td colspan="2">尚未選擇平台</td></tr>'}
            </tbody>
          </table>
          <div class="summary">
            &#x672A;&#x7A05;&#x55AE;&#x50F9;
            <strong>${escapeHtml(formatMoney(quote.unitPriceUntaxed))}</strong>
            <div style="margin-top: 12px; color: #6f7f84;">&#x672A;&#x7A05;&#x7E3D;&#x8A08; ${escapeHtml(formatMoney(quote.totalUntaxed))}</div>
            <div style="margin-top: 6px; color: #6f7f84;">&#x71DF;&#x696D;&#x7A05; 5% ${escapeHtml(formatMoney(quote.taxAmount || 0))}</div>
            <div style="margin-top: 6px; color: #0f5b63; font-weight: 700;">&#x542B;&#x7A05;&#x7E3D;&#x8A08; ${escapeHtml(formatMoney(quote.totalAmount || quote.totalUntaxed || 0))}</div>
          </div>
        </section>

        <section class="grid" style="margin-top: 24px;">
          <div class="card">
            <h2>案件狀態</h2>
            <div class="meta-row"><span class="meta-label">案件狀態</span><span class="meta-value">${escapeHtml(quote.caseStatus || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">請款狀態</span><span class="meta-value">${escapeHtml(quote.billingStatus || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">回簽日期</span><span class="meta-value">${escapeHtml(quote.signedAt || '—')}</span></div>
            <div class="meta-row"><span class="meta-label">結案日期</span><span class="meta-value">${escapeHtml(quote.closedAt || '—')}</span></div>
          </div>
          <div class="card">
            <h2>備註</h2>
            <div class="notes">${escapeHtml(quote.notes || '無')}</div>
          </div>
        </section>

        <div class="footer">製表日期 ${escapeHtml(new Date().toISOString().slice(0, 10))} | Game QA Hub</div>
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
    await page.setContent(buildPdfHtml(quote), { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
  } finally {
    await browser.close();
  }
}

async function persistQuotePdf(quote, { userId = null, db = mySqlDb } = {}) {
  const runtime = getRuntimeConfig();
  const storageDir = runtime.quotePdfStoragePath;
  await fs.mkdir(storageDir, { recursive: true });

  const pdfBuffer = await renderQuotePdfBuffer(quote);
  const safeName = sanitizeFilePart(quote.internalOrderNo || quote.quoteNo || `quote-${quote.id}`);
  const fileName = `${safeName}.pdf`;
  const filePath = path.join(storageDir, fileName);
  await fs.writeFile(filePath, pdfBuffer);

  const existing = await db.queryOne(
    "SELECT * FROM quote_attachments WHERE quote_id = ? AND attachment_kind = 'quote_pdf' LIMIT 1",
    [quote.id]
  );

  let attachmentId = existing?.id ? Number(existing.id) : null;

  if (existing?.file_path && existing.file_path !== filePath && await pathExists(existing.file_path)) {
    await fs.unlink(existing.file_path).catch(() => {});
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
