const crypto = require('crypto');

const mySqlDb = require('../connection/mySqlConnection');
const customerService = require('./customerService');
const quotePdfService = require('./quotePdfService');
const { getRuntimeConfig } = require('../config/env');
const { sendMail } = require('../utils/mailer');
const { HttpError } = require('../utils/http');

const PLATFORM_PRICES = {
  ios: 20000,
  android: 20000,
  web: 40000,
};
const QUOTE_TAX_RATE = 0.05;

const CASE_STATUSES = ['DRAFT', 'QUOTED', 'SIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'];
const BILLING_STATUSES = ['UNBILLED', 'BILLED', 'SETTLED'];
const CASE_STATUS_ORDER = new Map(CASE_STATUSES.map((value, index) => [value, index]));
const PLATFORM_CODES = {
  ios: 'IOS',
  android: 'ANDROID',
  web: 'WEB',
  other: 'OTHER',
};

function sanitizeText(value, max = 255) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function sanitizeHtml(value, max = 20000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function excelSerialToIso(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 0) return null;

  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpochUtc + Math.round(serial * 86400000));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateSegments(value) {
  const text = sanitizeText(value, 50);
  if (!text) return null;

  const cleaned = text
    .replace(/[.]/g, '/')
    .replace(/\u5e74/g, '/')
    .replace(/\u6708/g, '/')
    .replace(/\u65e5/g, '')
    .replace(/\u4e0a\u5348|\u4e0b\u5348|AM|PM|am|pm/g, '')
    .trim();

  const match = cleaned.match(/^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return null;

  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1000) year += 1911;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

function normalizeDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number') {
    const iso = excelSerialToIso(value);
    if (iso) return iso;
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    if (/^\d{5}(\.\d+)?$/.test(text)) {
      const iso = excelSerialToIso(Number(text));
      if (iso) return iso;
    }

    const parts = parseDateSegments(text);
    if (parts) {
      return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Invalid ${fieldName}`, 'INVALID_DATE');
  }

  return date.toISOString().slice(0, 10);
}

function parseNumber(value, fieldName, { integer = false, min = 0, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${fieldName} is required`, 'VALIDATION_ERROR');
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `Invalid ${fieldName}`, 'INVALID_NUMBER');

  const normalized = integer ? Math.round(parsed) : roundMoney(parsed);
  if (normalized < min) throw new HttpError(400, `${fieldName} must be >= ${min}`, 'INVALID_NUMBER');
  return normalized;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'Y' || value === 'y' || value === 'on') return true;
  return false;
}

function normalizePlatforms(payload = {}) {
  const source = payload.platforms && typeof payload.platforms === 'object' ? payload.platforms : payload;
  return {
    ios: normalizeBoolean(source.ios ?? source.platformIos),
    android: normalizeBoolean(source.android ?? source.platformAndroid),
    web: normalizeBoolean(source.web ?? source.platformWeb),
    other: normalizeBoolean(source.other ?? source.platformOther),
  };
}

function ensureStatus(value, allowed, fieldName) {
  const status = sanitizeText(value, 32).toUpperCase();
  if (!status) return allowed[0];
  if (!allowed.includes(status)) {
    throw new HttpError(400, `Invalid ${fieldName}`, 'INVALID_STATUS', { fieldName, value });
  }
  return status;
}

function computeCaseStatus(payload) {
  if (payload.caseStatus) return ensureStatus(payload.caseStatus, CASE_STATUSES, 'caseStatus');
  if (payload.closedAt) return 'CLOSED';
  if (payload.signedAt) return 'SIGNED';
  return 'QUOTED';
}

function computeBillingStatus(payload) {
  if (payload.billingStatus) return ensureStatus(payload.billingStatus, BILLING_STATUSES, 'billingStatus');
  if (payload.closedAt) return 'SETTLED';
  return 'UNBILLED';
}

function buildQuoteNo(dateValue = new Date()) {
  const stamp = normalizeDate(dateValue, 'quoteDate').replace(/-/g, '');
  return `QT${stamp}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function buildDedupeKey(payload) {
  const ref = sanitizeText(payload.customerOrderNo || payload.internalOrderNo || payload.customerName || 'NOREF', 64).toUpperCase();
  const game = sanitizeText(payload.gameTitle, 255).toUpperCase();
  const quoteDate = payload.quoteDate || 'NODATE';
  return [ref, game, quoteDate].join('|');
}

function parsePositiveInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function buildPricingBreakdown(platforms, quantity, otherPriceUntaxed, otherItemLabel = null) {
  const ios = platforms.ios ? PLATFORM_PRICES.ios : 0;
  const android = platforms.android ? PLATFORM_PRICES.android : 0;
  const web = platforms.web ? PLATFORM_PRICES.web : 0;
  const other = platforms.other ? roundMoney(otherPriceUntaxed) : 0;
  const unitPriceUntaxed = roundMoney(ios + android + web + other);
  const totalUntaxed = roundMoney(unitPriceUntaxed * quantity);
  const taxAmount = roundMoney(totalUntaxed * QUOTE_TAX_RATE);
  const totalAmount = roundMoney(totalUntaxed + taxAmount);

  return {
    ios,
    android,
    web,
    other,
    otherItemLabel: sanitizeText(otherItemLabel, 120) || null,
    quantity,
    unitPriceUntaxed,
    totalUntaxed,
    taxAmount,
    totalAmount,
  };
}

function normalizeQuotePayload(payload = {}, current = null) {
  const quoteDate = normalizeDate(payload.quoteDate ?? current?.quoteDate ?? new Date(), 'quoteDate');
  const signedAt = normalizeDate(payload.signedAt ?? current?.signedAt, 'signedAt');
  const closedAt = normalizeDate(payload.closedAt ?? current?.closedAt, 'closedAt');
  const platforms = normalizePlatforms(payload.platforms && typeof payload.platforms === 'object' ? payload.platforms : {
    ...current?.platforms,
    ...payload,
  });
  const quantity = parseNumber(payload.quantity ?? current?.quantity ?? 1, 'quantity', { integer: true, min: 1 });
  const otherPriceUntaxed = platforms.other
    ? parseNumber(payload.otherPriceUntaxed ?? current?.otherPriceUntaxed ?? 0, 'otherPriceUntaxed', { min: 1, required: true })
    : 0;
  const otherItemLabel = platforms.other
    ? sanitizeText(payload.otherItemLabel ?? current?.pricingBreakdown?.otherItemLabel ?? current?.otherItemLabel, 120)
    : null;
  const pricingBreakdown = buildPricingBreakdown(platforms, quantity, otherPriceUntaxed, otherItemLabel);

  if (!platforms.ios && !platforms.android && !platforms.web && !platforms.other) {
    throw new HttpError(400, 'At least one platform must be selected', 'VALIDATION_ERROR');
  }

  const customerId = parsePositiveInteger(payload.customerId ?? current?.customerId);
  const customerName = sanitizeText(payload.customerName ?? current?.customerName, 120);
  if (!customerId && !customerName) throw new HttpError(400, 'customer is required', 'VALIDATION_ERROR');

  const normalized = {
    customerId,
    quoteNo: sanitizeText(payload.quoteNo ?? current?.quoteNo, 32) || buildQuoteNo(quoteDate),
    quoteDate,
    customerOrderNo: sanitizeText(payload.customerOrderNo ?? current?.customerOrderNo, 64) || null,
    customerName,
    customerContactName: sanitizeText(payload.customerContactName ?? current?.customerContactName, 120) || null,
    customerContactEmail: sanitizeText(payload.customerContactEmail ?? current?.customerContactEmail, 200) || null,
    customerContactPhone: sanitizeText(payload.customerContactPhone ?? current?.customerContactPhone, 30) || null,
    billingEmail: sanitizeText(payload.billingEmail ?? current?.billingEmail, 200) || null,
    gameTitle: sanitizeText(payload.gameTitle ?? current?.gameTitle, 255),
    serviceName: sanitizeText((payload.serviceName ?? current?.serviceName) || 'APP\u6aa2\u6e2c\u670d\u52d9(IP\u6d41\u5411\u6aa2\u6e2c)', 255),
    platforms,
    signedAt,
    notes: sanitizeText(payload.notes ?? current?.notes, 4000) || null,
    internalOrderNo: sanitizeText(current?.internalOrderNo ?? payload.internalOrderNo, 64) || null,
    quantity,
    unitPriceUntaxed: pricingBreakdown.unitPriceUntaxed,
    totalUntaxed: pricingBreakdown.totalUntaxed,
    taxAmount: pricingBreakdown.taxAmount,
    totalAmount: pricingBreakdown.totalAmount,
    otherPriceUntaxed,
    closedAt,
    caseStatus: computeCaseStatus({ caseStatus: payload.caseStatus ?? current?.caseStatus, signedAt, closedAt }),
    billingStatus: computeBillingStatus({ billingStatus: payload.billingStatus ?? current?.billingStatus, closedAt }),
    sourceSheet: sanitizeText(payload.sourceSheet ?? current?.sourceSheet, 64) || null,
    sourceRowNo: payload.sourceRowNo || current?.sourceRowNo
      ? parseNumber(payload.sourceRowNo ?? current?.sourceRowNo, 'sourceRowNo', { integer: true, min: 1 })
      : null,
    salesOwnerUserId: parsePositiveInteger(payload.salesOwnerUserId ?? current?.salesOwnerUserId),
    pricingBreakdown,
  };

  if (!normalized.gameTitle) throw new HttpError(400, 'gameTitle is required', 'VALIDATION_ERROR');
  normalized.dedupeKey = buildDedupeKey(normalized);
  return normalized;
}

function normalizeLegacyQuoteRow(row) {
  const platforms = {
    ios: !!Number(row.platform_ios),
    android: !!Number(row.platform_android),
    web: !!Number(row.platform_web),
    other: !!Number(row.platform_other),
  };
  const quantity = Number(row.quantity) || 1;
  const basePrice = (platforms.ios ? PLATFORM_PRICES.ios : 0)
    + (platforms.android ? PLATFORM_PRICES.android : 0)
    + (platforms.web ? PLATFORM_PRICES.web : 0);
  const unitPriceUntaxed = roundMoney(row.unit_price_untaxed || 0);
  const otherPriceUntaxed = platforms.other ? Math.max(0, roundMoney(unitPriceUntaxed - basePrice)) : 0;
  const pricingBreakdown = buildPricingBreakdown(platforms, quantity, otherPriceUntaxed, null);

  return {
    quoteNo: row.quote_no,
    quoteDate: row.quote_date,
    customerOrderNo: row.customer_order_no,
    customerName: row.customer_name,
    customerContactName: row.customer_name,
    customerContactEmail: null,
    customerContactPhone: null,
    billingEmail: null,
    gameTitle: row.game_title,
    serviceName: row.service_name,
    internalOrderNo: row.internal_order_no,
    quantity,
    unitPriceUntaxed,
    totalUntaxed: pricingBreakdown.totalUntaxed,
    taxAmount: pricingBreakdown.taxAmount,
    totalAmount: pricingBreakdown.totalAmount,
    otherPriceUntaxed,
    platforms,
    signedAt: row.signed_at,
    closedAt: row.closed_at,
    caseStatus: ensureStatus(row.case_status || 'QUOTED', CASE_STATUSES, 'caseStatus'),
    billingStatus: ensureStatus(row.billing_status || 'UNBILLED', BILLING_STATUSES, 'billingStatus'),
    notes: row.notes,
    sourceSheet: row.source_sheet,
    sourceRowNo: row.source_row_no ? Number(row.source_row_no) : null,
    salesOwnerUserId: parsePositiveInteger(row.updated_by || row.created_by),
    dedupeKey: row.dedupe_key || buildDedupeKey({
      customerOrderNo: row.customer_order_no,
      internalOrderNo: row.internal_order_no,
      customerName: row.customer_name,
      gameTitle: row.game_title,
      quoteDate: row.quote_date,
    }),
    pricingBreakdown,
  };
}

function parsePricingBreakdown(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function platformCodesToMap(codes = []) {
  const enabled = new Set(codes || []);
  return {
    ios: enabled.has('IOS'),
    android: enabled.has('ANDROID'),
    web: enabled.has('WEB'),
    other: enabled.has('OTHER'),
  };
}

function buildEmailDraft(quote) {
  const subject = `[Game QA Hub] \u904a\u6232\u6aa2\u6e2c\u5831\u50f9\u55ae ${quote.internalOrderNo || quote.quoteNo || '?'}`.trim();
  const messageHtml =     `<p>${quote.customerContactName || quote.customerName || '\u60a8\u597d'}嚗?/p>
    <p>\u9644\u4ef6\u70ba\u672c\u6b21\u904a\u6232\u6aa2\u6e2c\u5831\u50f9\u55ae\uff0c\u8acb\u60a8\u67e5\u6536\u3002\u5982\u9700\u8abf\u6574\u5e73\u53f0\u5167\u5bb9\u6216\u88dc\u5145\u8cc7\u8a0a\uff0c\u6b61\u8fce\u76f4\u63a5\u56de\u4fe1\u8207\u6211\u5011\u806f\u7e6b\u3002</p>
    <p>\u5831\u50f9\u7de8\u865f\uFF1A${quote.internalOrderNo || quote.quoteNo || '?'}<br>\u904a\u6232\u540d\u7a31\uFF1A${quote.gameTitle || '?'}<br>\u5831\u50f9\u65e5\u671f\uFF1A${quote.quoteDate || '?'}</p>
    <p>\u8b1d\u8b1d\u3002</p>
    <p>Game QA Hub</p>`.trim();

  return { subject, messageHtml };
}

function stripHtml(value) {
  return String(value || '?').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureGame(tx, title, userId) {
  const safeTitle = sanitizeText(title, 255);
  if (!safeTitle) throw new HttpError(400, 'gameTitle is required', 'VALIDATION_ERROR');

  let game = await tx.queryOne('SELECT id, title FROM games WHERE title = ? LIMIT 1', [safeTitle]);
  if (game) return { id: Number(game.id), title: game.title };

  const result = await tx.query(
    `INSERT INTO games (game_code, title, status, created_by, updated_by)
     VALUES (?, ?, 'active', ?, ?)`,
    [null, safeTitle, userId || null, userId || null]
  );

  return { id: Number(result.insertId), title: safeTitle };
}

async function generateInternalOrderNo(tx, quoteDate) {
  const runtime = getRuntimeConfig();
  const prefix = sanitizeText(runtime.quoteNoPrefix || 'GQ', 20) || 'GQ';
  const datePart = normalizeDate(quoteDate, 'quoteDate').replace(/-/g, '');
  const latest = await tx.queryOne(
    'SELECT internal_order_no FROM quotes WHERE internal_order_no LIKE ? ORDER BY internal_order_no DESC LIMIT 1',
    [`${prefix}-${datePart}-%`]
  );

  let nextNumber = 1;
  if (latest?.internal_order_no) {
    const match = String(latest.internal_order_no).match(/-(\d{4,})$/);
    if (match) nextNumber = Number(match[1]) + 1;
  }

  for (let attempt = nextNumber; attempt < nextNumber + 1000; attempt += 1) {
    const candidate = `${prefix}-${datePart}-${String(attempt).padStart(4, '0')}`;
    const existing = await tx.queryOne('SELECT id FROM quotes WHERE internal_order_no = ? LIMIT 1', [candidate]);
    if (!existing) return candidate;
  }

  throw new HttpError(500, 'Unable to allocate internal order number', 'QUOTE_NO_EXHAUSTED');
}

async function syncQuotePlatforms(tx, quoteItemId, platforms) {
  await tx.query('DELETE FROM quote_platforms WHERE quote_item_id = ?', [quoteItemId]);
  const enabledCodes = Object.entries(PLATFORM_CODES)
    .filter(([key]) => platforms[key])
    .map(([, code]) => code);

  for (const code of enabledCodes) {
    await tx.query('INSERT INTO quote_platforms (quote_item_id, platform_code) VALUES (?, ?)', [quoteItemId, code]);
  }
}

async function upsertBillingRecord(tx, quoteId, normalized, userId) {
  const existing = await tx.queryOne('SELECT id FROM billing_records WHERE quote_id = ? LIMIT 1', [quoteId]);
  const billedAt = normalized.billingStatus === 'UNBILLED' ? null : (normalized.signedAt || normalized.quoteDate);
  const settledAt = normalized.billingStatus === 'SETTLED' ? (normalized.closedAt || normalized.signedAt || normalized.quoteDate) : null;

  if (existing) {
    await tx.query(
      `UPDATE billing_records
       SET billing_status = ?, billed_at = ?, settled_at = ?, amount_untaxed = ?, tax_amount = ?,
           amount_total = ?, note = ?, updated_by = ?
       WHERE quote_id = ?`,
      [
        normalized.billingStatus,
        billedAt,
        settledAt,
        normalized.totalUntaxed,
        normalized.taxAmount,
        normalized.totalAmount,
        'Synced from quote flow',
        userId || null,
        quoteId,
      ]
    );
    return;
  }

  await tx.query(
    `INSERT INTO billing_records (
      quote_id, billing_no, billing_status, billed_at, settled_at, amount_untaxed, tax_amount,
      amount_total, note, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      quoteId,
      normalized.billingStatus === 'UNBILLED' ? null : `BILL-${String(quoteId).padStart(8, '0')}`,
      normalized.billingStatus,
      billedAt,
      settledAt,
      normalized.totalUntaxed,
      normalized.taxAmount,
      normalized.totalAmount,
      'Synced from quote flow',
      userId || null,
      userId || null,
    ]
  );
}

async function logStatusChange(tx, quoteId, previous, next, userId, note) {
  if (!previous || previous.caseStatus !== next.caseStatus || previous.billingStatus !== next.billingStatus) {
    await tx.query(
      `INSERT INTO quote_status_logs (
        quote_id, from_status, to_status, from_billing_status, to_billing_status, changed_by, changed_at, note
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        quoteId,
        previous?.caseStatus || null,
        next.caseStatus,
        previous?.billingStatus || null,
        next.billingStatus,
        userId || null,
        note || (previous ? 'Quote updated' : 'Quote created'),
      ]
    );
  }
}

async function saveLegacyQuote(tx, normalized, { legacyId = null, userId = null } = {}) {
  const params = [
    normalized.quoteNo,
    normalized.quoteDate,
    normalized.customerOrderNo,
    normalized.customerName,
    normalized.gameTitle,
    normalized.serviceName,
    normalized.platforms.ios ? 1 : 0,
    normalized.platforms.android ? 1 : 0,
    normalized.platforms.web ? 1 : 0,
    normalized.platforms.other ? 1 : 0,
    normalized.signedAt,
    normalized.notes,
    normalized.internalOrderNo,
    normalized.quantity,
    normalized.unitPriceUntaxed,
    normalized.totalUntaxed,
    normalized.closedAt,
    normalized.caseStatus,
    normalized.billingStatus,
    normalized.sourceSheet,
    normalized.sourceRowNo,
    normalized.dedupeKey,
    userId,
  ];

  if (legacyId) {
    await tx.query(
      `UPDATE inspection_quotes
       SET quote_no = ?, quote_date = ?, customer_order_no = ?, customer_name = ?, game_title = ?, service_name = ?,
           platform_ios = ?, platform_android = ?, platform_web = ?, platform_other = ?, signed_at = ?, notes = ?,
           internal_order_no = ?, quantity = ?, unit_price_untaxed = ?, total_untaxed = ?, closed_at = ?,
           case_status = ?, billing_status = ?, source_sheet = ?, source_row_no = ?, dedupe_key = ?, updated_by = ?
       WHERE id = ?`,
      [...params, legacyId]
    );
    return legacyId;
  }

  const result = await tx.query(
    `INSERT INTO inspection_quotes (
      quote_no, quote_date, customer_order_no, customer_name, game_title, service_name,
      platform_ios, platform_android, platform_web, platform_other, signed_at, notes,
      internal_order_no, quantity, unit_price_untaxed, total_untaxed, closed_at, case_status,
      billing_status, source_sheet, source_row_no, dedupe_key, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...params, userId]
  );

  return Number(result.insertId);
}

async function saveFormalQuote(tx, normalized, customer, game, { quoteId = null, legacyInspectionQuoteId = null, existingQuoteRow = null, userId = null } = {}) {
  const resolvedInternalOrderNo = existingQuoteRow?.internal_order_no || normalized.internalOrderNo || await generateInternalOrderNo(tx, normalized.quoteDate);
  const resolvedQuoteNo = existingQuoteRow?.quote_no || normalized.quoteNo || buildQuoteNo(normalized.quoteDate);
  const resolvedCustomerContactName = normalized.customerContactName || customer.contactName || customer.name;
  const resolvedCustomerContactEmail = normalized.customerContactEmail || customer.billingEmail || customer.contactEmail || null;
  const resolvedSalesOwnerUserId = normalized.salesOwnerUserId || existingQuoteRow?.sales_owner_user_id || userId || null;
  const resolvedDedupeKey = buildDedupeKey({
    customerOrderNo: normalized.customerOrderNo,
    internalOrderNo: resolvedInternalOrderNo,
    customerName: customer.name,
    gameTitle: normalized.gameTitle,
    quoteDate: normalized.quoteDate,
  });

  const quoteBaseParams = [
    resolvedQuoteNo,
    normalized.quoteDate,
    customer.id,
    resolvedSalesOwnerUserId,
    normalized.customerOrderNo,
    resolvedInternalOrderNo,
    resolvedCustomerContactName,
    resolvedCustomerContactEmail,
    normalized.serviceName,
    normalized.caseStatus,
    normalized.billingStatus,
    normalized.signedAt,
    normalized.closedAt,
    normalized.totalUntaxed,
    normalized.taxAmount,
    normalized.totalAmount,
    normalized.notes,
    normalized.sourceSheet,
    normalized.sourceRowNo,
    resolvedDedupeKey,
    legacyInspectionQuoteId,
  ];

  let resolvedQuoteId = quoteId;

  if (resolvedQuoteId) {
    await tx.query(
      `UPDATE quotes
       SET quote_no = ?, quote_date = ?, customer_id = ?, sales_owner_user_id = ?, customer_order_no = ?,
           internal_order_no = ?, customer_contact_name = ?, customer_contact_email = ?, service_name = ?,
           case_status = ?, billing_status = ?, signed_at = ?, closed_at = ?, subtotal_untaxed = ?, tax_amount = ?, total_amount = ?,
           notes = ?, source_sheet = ?, source_row_no = ?, dedupe_key = ?, legacy_inspection_quote_id = ?, updated_by = ?
       WHERE id = ?`,
      [...quoteBaseParams, userId, resolvedQuoteId]
    );
  } else {
    const result = await tx.query(
      `INSERT INTO quotes (
        quote_no, quote_date, customer_id, sales_owner_user_id, customer_order_no, internal_order_no,
        customer_contact_name, customer_contact_email, service_name, case_status, billing_status, signed_at,
        closed_at, subtotal_untaxed, tax_amount, total_amount, notes, source_sheet, source_row_no,
        dedupe_key, legacy_inspection_quote_id, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...quoteBaseParams, userId, userId]
    );
    resolvedQuoteId = Number(result.insertId);
  }

  const existingItem = await tx.queryOne('SELECT id FROM quote_items WHERE quote_id = ? AND line_no = 1 LIMIT 1', [resolvedQuoteId]);
  let quoteItemId = existingItem?.id ? Number(existingItem.id) : null;

  if (quoteItemId) {
    await tx.query(
      `UPDATE quote_items
       SET game_id = ?, game_title_snapshot = ?, quantity = ?, unit_price_untaxed = ?, other_price_untaxed = ?,
           tax_amount = ?, line_total_untaxed = ?, line_total_amount = ?, notes = ?, pricing_breakdown_json = ?
       WHERE id = ?`,
      [
        game.id,
        normalized.gameTitle,
        normalized.quantity,
        normalized.unitPriceUntaxed,
        normalized.otherPriceUntaxed,
        normalized.taxAmount,
        normalized.totalUntaxed,
        normalized.totalAmount,
        normalized.notes,
        JSON.stringify(normalized.pricingBreakdown),
        quoteItemId,
      ]
    );
  } else {
    const result = await tx.query(
      `INSERT INTO quote_items (
        quote_id, line_no, game_id, game_title_snapshot, quantity, unit_price_untaxed, other_price_untaxed,
        tax_amount, line_total_untaxed, line_total_amount, notes, pricing_breakdown_json
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resolvedQuoteId,
        game.id,
        normalized.gameTitle,
        normalized.quantity,
        normalized.unitPriceUntaxed,
        normalized.otherPriceUntaxed,
        normalized.taxAmount,
        normalized.totalUntaxed,
        normalized.totalAmount,
        normalized.notes,
        JSON.stringify(normalized.pricingBreakdown),
      ]
    );
    quoteItemId = Number(result.insertId);
  }

  await syncQuotePlatforms(tx, quoteItemId, normalized.platforms);
  await upsertBillingRecord(tx, resolvedQuoteId, normalized, userId);
  await logStatusChange(
    tx,
    resolvedQuoteId,
    existingQuoteRow ? { caseStatus: existingQuoteRow.case_status, billingStatus: existingQuoteRow.billing_status } : null,
    { caseStatus: normalized.caseStatus, billingStatus: normalized.billingStatus },
    userId,
    existingQuoteRow ? 'Quote updated via quotation form' : 'Quote created via quotation form'
  );

  return {
    quoteId: resolvedQuoteId,
    quoteNo: resolvedQuoteNo,
    internalOrderNo: resolvedInternalOrderNo,
    customerContactName: resolvedCustomerContactName,
    customerContactEmail: resolvedCustomerContactEmail,
  };
}

async function syncLegacyQuotesToFormal(limit = 200) {
  const legacyRows = await mySqlDb.query(
    `SELECT iq.*
     FROM inspection_quotes iq
     LEFT JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
     WHERE q.id IS NULL
     ORDER BY iq.id ASC
     LIMIT ${Math.min(Math.max(Number(limit) || 200, 1), 500)}`
  );

  for (const row of legacyRows) {
    await mySqlDb.withTransaction(async (tx) => {
      const normalized = normalizeLegacyQuoteRow(row);
      const customer = await customerService.ensureCustomer(
        { id: row.updated_by || row.created_by || null },
        {
          customerName: normalized.customerName,
          customerContactName: normalized.customerContactName,
          customerContactEmail: normalized.customerContactEmail,
          billingEmail: normalized.billingEmail,
          customerContactPhone: normalized.customerContactPhone,
        },
        { tx }
      );
      const game = await ensureGame(tx, normalized.gameTitle, row.updated_by || row.created_by || null);
      const existingFormal = await tx.queryOne(
        `SELECT *
         FROM quotes
         WHERE legacy_inspection_quote_id = ? OR dedupe_key = ? OR quote_no = ?
         ORDER BY id ASC
         LIMIT 1`,
        [row.id, normalized.dedupeKey, normalized.quoteNo]
      );

      await saveFormalQuote(tx, normalized, customer, game, {
        quoteId: existingFormal?.id ? Number(existingFormal.id) : null,
        legacyInspectionQuoteId: row.id,
        existingQuoteRow: existingFormal,
        userId: row.updated_by || row.created_by || null,
      });
    });
  }
}

async function getQuoteRows(filters = {}, { caseOnly = false, tx = mySqlDb } = {}) {
  const where = [];
  const params = [];
  const keyword = sanitizeText(filters.q || filters.keyword, 120);

  if (keyword) {
    where.push('(q.quote_no LIKE ? OR q.internal_order_no LIKE ? OR c.name LIKE ? OR q.customer_order_no LIKE ? OR qi.game_title_snapshot LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const caseStatus = sanitizeText(filters.caseStatus, 20).toUpperCase();
  if (caseStatus) {
    where.push('q.case_status = ?');
    params.push(caseStatus);
  }

  const billingStatus = sanitizeText(filters.billingStatus, 20).toUpperCase();
  if (billingStatus) {
    where.push('q.billing_status = ?');
    params.push(billingStatus);
  }

  const month = sanitizeText(filters.month, 7);
  if (/^\d{4}-\d{2}$/.test(month)) {
    where.push("DATE_FORMAT(q.quote_date, '%Y-%m') = ?");
    params.push(month);
  }

  const customerName = sanitizeText(filters.customerName, 120);
  if (customerName) {
    where.push('c.name = ?');
    params.push(customerName);
  }

  const platform = sanitizeText(filters.platform, 20).toUpperCase();
  if (platform && Object.values(PLATFORM_CODES).includes(platform)) {
    where.push(`EXISTS (
      SELECT 1 FROM quote_platforms qp_filter
      INNER JOIN quote_items qi_filter ON qi_filter.id = qp_filter.quote_item_id
      WHERE qi_filter.quote_id = q.id AND qp_filter.platform_code = ?
    )`);
    params.push(platform);
  }

  if (caseOnly) {
    where.push("q.case_status <> 'DRAFT'");
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);

  return tx.query(
    `SELECT
        q.id,
        q.quote_no,
        q.quote_date,
        q.customer_id,
        q.customer_order_no,
        q.internal_order_no,
        q.customer_contact_name,
        q.customer_contact_email,
        q.service_name,
        q.case_status,
        q.billing_status,
        q.signed_at,
        q.closed_at,
        q.notes,
        q.source_sheet,
        q.source_row_no,
        q.created_at,
        q.updated_at,
        q.sales_owner_user_id,
        q.last_sent_at,
        q.last_sent_to,
        q.last_sent_cc,
        q.tax_amount,
        q.total_amount,
        q.legacy_inspection_quote_id,
        q.pdf_attachment_id,
        c.name AS customer_name,
        c.contact_name AS master_contact_name,
        c.contact_email AS master_contact_email,
        c.contact_phone AS master_contact_phone,
        c.billing_email AS master_billing_email,
        qi.game_title_snapshot,
        qi.quantity,
        qi.unit_price_untaxed,
        qi.other_price_untaxed,
        qi.tax_amount,
        qi.line_total_untaxed,
        qi.line_total_amount,
        qi.pricing_breakdown_json,
        att.file_name AS pdf_file_name,
        att.file_path AS pdf_file_path,
        att.mime_type AS pdf_mime_type,
        att.file_size AS pdf_file_size,
        CASE WHEN q.signed_at IS NULL THEN NULL ELSE DATEDIFF(q.signed_at, q.quote_date) END AS days_to_sign,
        CASE WHEN q.closed_at IS NULL THEN NULL ELSE DATEDIFF(q.closed_at, q.quote_date) END AS days_to_close
     FROM quotes q
     INNER JOIN customers c ON c.id = q.customer_id
     LEFT JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
     LEFT JOIN quote_attachments att ON att.id = q.pdf_attachment_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY q.quote_date DESC, q.id DESC
     LIMIT ${limit}`,
    params
  );
}

async function hydrateQuotes(rows, { tx = mySqlDb } = {}) {
  if (!rows.length) return [];
  const quoteIds = rows.map((row) => Number(row.id));
  const placeholders = quoteIds.map(() => '?').join(',');
  const platformRows = await tx.query(
    `SELECT qi.quote_id, qp.platform_code
     FROM quote_items qi
     INNER JOIN quote_platforms qp ON qp.quote_item_id = qi.id
     WHERE qi.quote_id IN (${placeholders})`,
    quoteIds
  );

  const platformMap = new Map();
  for (const platformRow of platformRows) {
    const quoteId = Number(platformRow.quote_id);
    const list = platformMap.get(quoteId) || [];
    list.push(platformRow.platform_code);
    platformMap.set(quoteId, list);
  }

  const runtime = getRuntimeConfig();
  return rows.map((row) => {
    const platforms = platformCodesToMap(platformMap.get(Number(row.id)) || []);
    const fallbackUntaxed = Number(row.line_total_untaxed || 0);
    const storedTaxAmount = Number(row.tax_amount || 0);
    const storedTotalAmount = Number(row.line_total_amount || row.total_amount || 0);
    const fallbackTaxAmount = storedTaxAmount || roundMoney(fallbackUntaxed * QUOTE_TAX_RATE);
    const fallbackTotalAmount = (storedTotalAmount && !(storedTaxAmount === 0 && storedTotalAmount === fallbackUntaxed))
      ? storedTotalAmount
      : roundMoney(fallbackUntaxed + fallbackTaxAmount);
    const pricingBreakdown = parsePricingBreakdown(row.pricing_breakdown_json, {
      ios: platforms.ios ? PLATFORM_PRICES.ios : 0,
      android: platforms.android ? PLATFORM_PRICES.android : 0,
      web: platforms.web ? PLATFORM_PRICES.web : 0,
      other: Number(row.other_price_untaxed || 0),
      quantity: Number(row.quantity || 1),
      unitPriceUntaxed: Number(row.unit_price_untaxed || 0),
      totalUntaxed: fallbackUntaxed,
      taxAmount: fallbackTaxAmount,
      totalAmount: fallbackTotalAmount,
    });

    const quote = {
      id: Number(row.id),
      quoteNo: row.quote_no,
      quoteDate: row.quote_date,
      customerId: Number(row.customer_id),
      customerOrderNo: row.customer_order_no,
      internalOrderNo: row.internal_order_no,
      customerName: row.customer_name,
      customerContactName: row.customer_contact_name || row.master_contact_name || row.customer_name,
      customerContactEmail: row.customer_contact_email || row.master_billing_email || row.master_contact_email || null,
      customerContactPhone: row.master_contact_phone || null,
      billingEmail: row.master_billing_email || row.customer_contact_email || row.master_contact_email || null,
      salesOwnerUserId: row.sales_owner_user_id ? Number(row.sales_owner_user_id) : null,
      salesCcEmail: row.last_sent_cc || null,
      gameTitle: row.game_title_snapshot,
      serviceName: row.service_name,
      quantity: Number(row.quantity || 1),
      unitPriceUntaxed: Number(row.unit_price_untaxed || 0),
      totalUntaxed: fallbackUntaxed,
      taxAmount: fallbackTaxAmount,
      totalAmount: fallbackTotalAmount,
      otherPriceUntaxed: Number(row.other_price_untaxed || 0),
      pricingBreakdown,
      platforms,
      signedAt: row.signed_at,
      closedAt: row.closed_at,
      caseStatus: row.case_status,
      billingStatus: row.billing_status,
      notes: row.notes,
      sourceSheet: row.source_sheet,
      sourceRowNo: row.source_row_no ? Number(row.source_row_no) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      daysToSign: row.days_to_sign === null || row.days_to_sign === undefined ? null : Number(row.days_to_sign),
      daysToClose: row.days_to_close === null || row.days_to_close === undefined ? null : Number(row.days_to_close),
      legacyInspectionQuoteId: row.legacy_inspection_quote_id ? Number(row.legacy_inspection_quote_id) : null,
      lastSentAt: row.last_sent_at,
      lastSentTo: row.last_sent_to,
      lastSentCc: row.last_sent_cc,
      pdfStatus: !!row.pdf_attachment_id,
      pdfAttachment: row.pdf_attachment_id ? {
        id: Number(row.pdf_attachment_id),
        fileName: row.pdf_file_name,
        filePath: row.pdf_file_path,
        mimeType: row.pdf_mime_type,
        fileSize: row.pdf_file_size ? Number(row.pdf_file_size) : null,
      } : null,
    };

    quote.emailDraft = buildEmailDraft(quote);
    return quote;
  });
}

async function getFormalQuoteById(id, { tx = mySqlDb } = {}) {
  const row = await tx.queryOne(
    `SELECT
        q.id,
        q.quote_no,
        q.quote_date,
        q.customer_id,
        q.customer_order_no,
        q.internal_order_no,
        q.customer_contact_name,
        q.customer_contact_email,
        q.service_name,
        q.case_status,
        q.billing_status,
        q.signed_at,
        q.closed_at,
        q.notes,
        q.source_sheet,
        q.source_row_no,
        q.created_at,
        q.updated_at,
        q.sales_owner_user_id,
        q.last_sent_at,
        q.last_sent_to,
        q.last_sent_cc,
        q.legacy_inspection_quote_id,
        q.pdf_attachment_id,
        c.name AS customer_name,
        c.contact_name AS master_contact_name,
        c.contact_email AS master_contact_email,
        c.contact_phone AS master_contact_phone,
        c.billing_email AS master_billing_email,
        qi.game_title_snapshot,
        qi.quantity,
        qi.unit_price_untaxed,
        qi.other_price_untaxed,
        qi.line_total_untaxed,
        qi.pricing_breakdown_json,
        att.file_name AS pdf_file_name,
        att.file_path AS pdf_file_path,
        att.mime_type AS pdf_mime_type,
        att.file_size AS pdf_file_size,
        CASE WHEN q.signed_at IS NULL THEN NULL ELSE DATEDIFF(q.signed_at, q.quote_date) END AS days_to_sign,
        CASE WHEN q.closed_at IS NULL THEN NULL ELSE DATEDIFF(q.closed_at, q.quote_date) END AS days_to_close
     FROM quotes q
     INNER JOIN customers c ON c.id = q.customer_id
     LEFT JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
     LEFT JOIN quote_attachments att ON att.id = q.pdf_attachment_id
     WHERE q.id = ?
     LIMIT 1`,
    [id]
  );

  if (!row) return null;
  const quotes = await hydrateQuotes([row], { tx });
  return quotes[0] || null;
}

async function getExistingQuoteRow(tx, id) {
  return tx.queryOne('SELECT * FROM quotes WHERE id = ? LIMIT 1', [id]);
}

async function listQuotes(filters = {}) {
  await syncLegacyQuotesToFormal();
  const rows = await getQuoteRows(filters);
  return hydrateQuotes(rows);
}

async function listCases(filters = {}) {
  await syncLegacyQuotesToFormal();
  const rows = await getQuoteRows(filters, { caseOnly: true });
  const quotes = await hydrateQuotes(rows);
  return quotes.map((quote) => ({
    ...quote,
    daysOpen: quote.closedAt
      ? quote.daysToClose
      : Math.max(0, Math.floor((Date.now() - new Date(`${quote.quoteDate}T00:00:00`).getTime()) / 86400000)),
  }));
}

async function getQuoteById(id) {
  await syncLegacyQuotesToFormal();
  const quote = await getFormalQuoteById(id);
  if (!quote) throw new HttpError(404, 'Quote not found', 'QUOTE_NOT_FOUND');
  return quote;
}

async function persistQuote(user, payload, { id = null, fromLegacyRow = null } = {}) {
  const current = id ? await getFormalQuoteById(id) : null;
  const normalized = fromLegacyRow ? normalizeLegacyQuoteRow(fromLegacyRow) : normalizeQuotePayload(payload, current);

  const quoteId = await mySqlDb.withTransaction(async (tx) => {
    const existingQuoteRow = id ? await getExistingQuoteRow(tx, id) : null;
    const customer = await customerService.ensureCustomer(
      user,
      {
        customerId: normalized.customerId,
        customerName: normalized.customerName,
        customerContactName: normalized.customerContactName,
        customerContactEmail: normalized.customerContactEmail,
        customerContactPhone: normalized.customerContactPhone,
        billingEmail: normalized.billingEmail,
      },
      { tx }
    );
    const game = await ensureGame(tx, normalized.gameTitle, user?.id || null);
    const resolved = {
      ...normalized,
      customerName: customer.name,
      customerContactName: normalized.customerContactName || customer.contactName || customer.name,
      customerContactEmail: normalized.customerContactEmail || customer.billingEmail || customer.contactEmail || null,
      billingEmail: normalized.billingEmail || customer.billingEmail || customer.contactEmail || null,
    };

    let legacyInspectionQuoteId = existingQuoteRow?.legacy_inspection_quote_id ? Number(existingQuoteRow.legacy_inspection_quote_id) : null;
    if (!fromLegacyRow) {
      const previewInternalOrderNo = existingQuoteRow?.internal_order_no || resolved.internalOrderNo || await generateInternalOrderNo(tx, resolved.quoteDate);
      resolved.internalOrderNo = previewInternalOrderNo;
      resolved.dedupeKey = buildDedupeKey({
        customerOrderNo: resolved.customerOrderNo,
        internalOrderNo: previewInternalOrderNo,
        customerName: resolved.customerName,
        gameTitle: resolved.gameTitle,
        quoteDate: resolved.quoteDate,
      });
      legacyInspectionQuoteId = await saveLegacyQuote(tx, resolved, {
        legacyId: legacyInspectionQuoteId,
        userId: user?.id || null,
      });
    } else {
      legacyInspectionQuoteId = fromLegacyRow.id;
    }

    const result = await saveFormalQuote(tx, resolved, customer, game, {
      quoteId: id,
      legacyInspectionQuoteId,
      existingQuoteRow,
      userId: user?.id || fromLegacyRow?.updated_by || fromLegacyRow?.created_by || null,
    });

    return result.quoteId;
  });

  return getQuoteById(quoteId);
}

async function createQuote(user, payload) {
  return persistQuote(user, payload);
}

async function updateQuote(id, user, payload) {
  const quote = await getFormalQuoteById(id);
  if (!quote) throw new HttpError(404, 'Quote not found', 'QUOTE_NOT_FOUND');
  return persistQuote(user, payload, { id });
}

function assertCaseTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  if (!CASE_STATUS_ORDER.has(currentStatus) || !CASE_STATUS_ORDER.has(nextStatus)) {
    throw new HttpError(400, 'Invalid case status', 'INVALID_STATUS');
  }
  if (CASE_STATUS_ORDER.get(nextStatus) < CASE_STATUS_ORDER.get(currentStatus)) {
    throw new HttpError(409, 'Case status cannot move backwards', 'INVALID_CASE_TRANSITION', {
      currentStatus,
      nextStatus,
    });
  }
}

async function updateCaseStatus(id, user, payload = {}) {
  const current = await getQuoteById(id);
  const nextCaseStatus = payload.caseStatus ? ensureStatus(payload.caseStatus, CASE_STATUSES, 'caseStatus') : current.caseStatus;
  assertCaseTransition(current.caseStatus, nextCaseStatus);

  return updateQuote(id, user, {
    ...current,
    signedAt: payload.signedAt !== undefined ? payload.signedAt : current.signedAt,
    closedAt: payload.closedAt !== undefined
      ? payload.closedAt
      : nextCaseStatus === 'CLOSED'
        ? (current.closedAt || new Date().toISOString().slice(0, 10))
        : current.closedAt,
    caseStatus: nextCaseStatus,
    billingStatus: payload.billingStatus || current.billingStatus,
    notes: payload.notes !== undefined ? payload.notes : current.notes,
  });
}

async function generateQuotePdf(id, user) {
  const quote = await getQuoteById(id);
  const attachment = await quotePdfService.persistQuotePdf(quote, { userId: user?.id || null });
  const refreshedQuote = await getQuoteById(id);
  return { quote: refreshedQuote, attachment };
}

async function listQuoteSendLogs(id) {
  const quote = await getQuoteById(id);
  const rows = await mySqlDb.query(
    `SELECT id, quote_id, subject, recipient_to, recipient_cc, attachment_name, sent_by, sent_at, send_status, provider_message_id, provider_response
     FROM quote_send_logs
     WHERE quote_id = ?
     ORDER BY sent_at DESC, id DESC`,
    [quote.id]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    quoteId: Number(row.quote_id),
    subject: row.subject,
    recipientTo: row.recipient_to,
    recipientCc: row.recipient_cc,
    attachmentName: row.attachment_name,
    sentBy: row.sent_by ? Number(row.sent_by) : null,
    sentAt: row.sent_at,
    sendStatus: row.send_status,
    providerMessageId: row.provider_message_id,
    providerResponse: row.provider_response,
  }));
}

async function sendQuote(id, user, payload = {}) {
  const quote = await getQuoteById(id);
  const to = sanitizeText(payload.to || quote.customerContactEmail, 200);
  if (!to) {
    throw new HttpError(400, 'Customer email is required before sending quotation', 'QUOTE_EMAIL_REQUIRED');
  }

  const runtime = getRuntimeConfig();
  const cc = sanitizeText(payload.cc || runtime.quoteSalesCcEmail, 500);
  if (!cc) {
    throw new HttpError(400, 'QUOTE_SALES_CC_EMAIL is not configured', 'QUOTE_SALES_CC_REQUIRED');
  }

  const draft = buildEmailDraft(quote);
  const subject = sanitizeText(payload.subject || draft.subject, 255) || draft.subject;
  const messageHtml = sanitizeHtml(payload.messageHtml || draft.messageHtml, 20000) || draft.messageHtml;

  const pdf = await quotePdfService.persistQuotePdf(quote, { userId: user?.id || null });

  try {
    const response = await sendMail({
      to,
      cc,
      subject,
      html: messageHtml,
      text: stripHtml(messageHtml),
      attachments: [
        {
          filename: pdf.fileName,
          path: pdf.filePath,
          contentType: 'application/pdf',
        },
      ],
    });

    await mySqlDb.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO quote_send_logs (
          quote_id, subject, recipient_to, recipient_cc, attachment_name, message_html,
          sent_by, sent_at, send_status, provider_message_id, provider_response
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'SUCCESS', ?, ?)`,
        [
          quote.id,
          subject,
          to,
          cc,
          pdf.fileName,
          messageHtml,
          user?.id || null,
          response?.messageId || null,
          response ? JSON.stringify({ accepted: response.accepted, rejected: response.rejected }) : null,
        ]
      );

      await tx.query(
        'UPDATE quotes SET last_sent_at = NOW(), last_sent_to = ?, last_sent_cc = ? WHERE id = ?',
        [to, cc, quote.id]
      );
    });

    return {
      sentAt: new Date().toISOString(),
      to,
      cc,
      subject,
      attachmentName: pdf.fileName,
      messageId: response?.messageId || null,
    };
  } catch (error) {
    await mySqlDb.query(
      `INSERT INTO quote_send_logs (
        quote_id, subject, recipient_to, recipient_cc, attachment_name, message_html,
        sent_by, sent_at, send_status, provider_response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'FAILED', ?)`,
      [
        quote.id,
        subject,
        to,
        cc,
        pdf.fileName,
        messageHtml,
        user?.id || null,
        error?.message || 'Unknown send failure',
      ]
    );
    throw new HttpError(502, 'Failed to send quotation email', 'QUOTE_SEND_FAILED', { message: error?.message || 'Unknown error' });
  }
}

module.exports = {
  CASE_STATUSES,
  BILLING_STATUSES,
  PLATFORM_PRICES,
  listQuotes,
  listCases,
  getQuoteById,
  createQuote,
  updateQuote,
  updateCaseStatus,
  generateQuotePdf,
  sendQuote,
  listQuoteSendLogs,
  syncLegacyQuotesToFormal,
  _internals: {
    normalizeDate,
    normalizePlatforms,
    normalizeQuotePayload,
    normalizeLegacyQuoteRow,
    buildDedupeKey,
    buildQuoteNo,
    buildEmailDraft,
    assertCaseTransition,
    buildPricingBreakdown,
  },
};

