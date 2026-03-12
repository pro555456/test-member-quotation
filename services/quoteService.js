const crypto = require("crypto");

const mySqlDb = require("../connection/mySqlConnection");
const { HttpError } = require("../utils/http");

const CASE_STATUSES = ["DRAFT", "QUOTED", "SIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"];
const BILLING_STATUSES = ["UNBILLED", "BILLED", "SETTLED"];
const CASE_STATUS_ORDER = new Map(CASE_STATUSES.map((value, index) => [value, index]));

function sanitizeText(value, max = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
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
    .replace(/[.]/g, "/")
    .replace(/年/g, "/")
    .replace(/月/g, "/")
    .replace(/日/g, "")
    .replace(/上午|下午|AM|PM|am|pm/g, "")
    .trim();

  const match = cleaned.match(/^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return null;

  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1000) {
    year += 1911;
  }

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

function normalizeDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number") {
    const iso = excelSerialToIso(value);
    if (iso) return iso;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.slice(0, 10);
    }

    if (/^\d{5}(\.\d+)?$/.test(text)) {
      const iso = excelSerialToIso(Number(text));
      if (iso) return iso;
    }

    const parts = parseDateSegments(text);
    if (parts) {
      return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Invalid ${fieldName}`, "INVALID_DATE");
  }

  return date.toISOString().slice(0, 10);
}

function parseNumber(value, fieldName, { integer = false, min = 0 } = {}) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `Invalid ${fieldName}`, "INVALID_NUMBER");
  }

  const normalized = integer ? Math.round(parsed) : Math.round(parsed * 100) / 100;
  if (normalized < min) {
    throw new HttpError(400, `${fieldName} must be >= ${min}`, "INVALID_NUMBER");
  }
  return normalized;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true" || value === "Y" || value === "y") return true;
  return false;
}

function normalizePlatforms(payload = {}) {
  const source = payload.platforms && typeof payload.platforms === "object" ? payload.platforms : payload;
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
    throw new HttpError(400, `Invalid ${fieldName}`, "INVALID_STATUS", { fieldName, value });
  }
  return status;
}

function computeCaseStatus(payload) {
  if (payload.caseStatus) {
    return ensureStatus(payload.caseStatus, CASE_STATUSES, "caseStatus");
  }
  if (payload.closedAt) return "CLOSED";
  if (payload.signedAt) return "SIGNED";
  return "QUOTED";
}

function computeBillingStatus(payload) {
  if (payload.billingStatus) {
    return ensureStatus(payload.billingStatus, BILLING_STATUSES, "billingStatus");
  }
  if (payload.closedAt) return "SETTLED";
  return "UNBILLED";
}

function buildDedupeKey(payload) {
  const ref = sanitizeText(payload.customerOrderNo || payload.internalOrderNo || "NOREF", 64).toUpperCase();
  const game = sanitizeText(payload.gameTitle, 255).toUpperCase();
  const quoteDate = payload.quoteDate || "NODATE";
  return [ref, game, quoteDate].join("|");
}

function buildQuoteNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `QT${stamp}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function normalizeQuotePayload(payload = {}) {
  const quoteDate = normalizeDate(payload.quoteDate, "quoteDate");
  const signedAt = normalizeDate(payload.signedAt, "signedAt");
  const closedAt = normalizeDate(payload.closedAt, "closedAt");
  const platforms = normalizePlatforms(payload);
  const quantity = parseNumber(payload.quantity ?? 1, "quantity", { integer: true, min: 1 });
  const unitPriceUntaxed = parseNumber(payload.unitPriceUntaxed, "unitPriceUntaxed", { min: 0 });
  const totalUntaxed = payload.totalUntaxed === undefined || payload.totalUntaxed === null || payload.totalUntaxed === ""
    ? Math.round(quantity * unitPriceUntaxed * 100) / 100
    : parseNumber(payload.totalUntaxed, "totalUntaxed", { min: 0 });

  const normalized = {
    quoteNo: sanitizeText(payload.quoteNo, 32) || buildQuoteNo(),
    quoteDate,
    customerOrderNo: sanitizeText(payload.customerOrderNo, 64) || null,
    customerName: sanitizeText(payload.customerName, 120),
    gameTitle: sanitizeText(payload.gameTitle, 255),
    serviceName: sanitizeText(payload.serviceName || "APP檢測服務(IP流向檢測)", 255),
    platforms,
    signedAt,
    notes: sanitizeText(payload.notes, 4000) || null,
    internalOrderNo: sanitizeText(payload.internalOrderNo, 64) || null,
    quantity,
    unitPriceUntaxed,
    totalUntaxed,
    closedAt,
    caseStatus: computeCaseStatus({ caseStatus: payload.caseStatus, signedAt, closedAt }),
    billingStatus: computeBillingStatus({ billingStatus: payload.billingStatus, closedAt }),
    sourceSheet: sanitizeText(payload.sourceSheet, 64) || null,
    sourceRowNo: payload.sourceRowNo ? parseNumber(payload.sourceRowNo, "sourceRowNo", { integer: true, min: 1 }) : null,
  };

  if (!normalized.quoteDate) throw new HttpError(400, "quoteDate is required", "VALIDATION_ERROR");
  if (!normalized.customerName) throw new HttpError(400, "customerName is required", "VALIDATION_ERROR");
  if (!normalized.gameTitle) throw new HttpError(400, "gameTitle is required", "VALIDATION_ERROR");

  normalized.dedupeKey = buildDedupeKey(normalized);
  return normalized;
}

function mapQuoteRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    quoteNo: row.quote_no,
    quoteDate: row.quote_date,
    customerOrderNo: row.customer_order_no,
    customerName: row.customer_name,
    gameTitle: row.game_title,
    serviceName: row.service_name,
    platforms: {
      ios: !!Number(row.platform_ios),
      android: !!Number(row.platform_android),
      web: !!Number(row.platform_web),
      other: !!Number(row.platform_other),
    },
    signedAt: row.signed_at,
    notes: row.notes,
    internalOrderNo: row.internal_order_no,
    quantity: Number(row.quantity),
    unitPriceUntaxed: Number(row.unit_price_untaxed),
    totalUntaxed: Number(row.total_untaxed),
    closedAt: row.closed_at,
    caseStatus: row.case_status,
    billingStatus: row.billing_status,
    sourceSheet: row.source_sheet,
    sourceRowNo: row.source_row_no ? Number(row.source_row_no) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysToSign: row.days_to_sign === null || row.days_to_sign === undefined ? null : Number(row.days_to_sign),
    daysToClose: row.days_to_close === null || row.days_to_close === undefined ? null : Number(row.days_to_close),
  };
}

async function findById(id, tx = mySqlDb) {
  return tx.queryOne(
    `SELECT *,
            CASE WHEN signed_at IS NULL THEN NULL ELSE DATEDIFF(signed_at, quote_date) END AS days_to_sign,
            CASE WHEN closed_at IS NULL THEN NULL ELSE DATEDIFF(closed_at, quote_date) END AS days_to_close
     FROM inspection_quotes
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
}

async function saveNormalizedQuote(normalized, { id = null, userId = null, tx = mySqlDb } = {}) {
  if (id) {
    await tx.query(
      `UPDATE inspection_quotes
       SET quote_no = ?,
           quote_date = ?,
           customer_order_no = ?,
           customer_name = ?,
           game_title = ?,
           service_name = ?,
           platform_ios = ?,
           platform_android = ?,
           platform_web = ?,
           platform_other = ?,
           signed_at = ?,
           notes = ?,
           internal_order_no = ?,
           quantity = ?,
           unit_price_untaxed = ?,
           total_untaxed = ?,
           closed_at = ?,
           case_status = ?,
           billing_status = ?,
           source_sheet = ?,
           source_row_no = ?,
           dedupe_key = ?,
           updated_by = ?
       WHERE id = ?`,
      [
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
        id,
      ]
    );
    return id;
  }

  const result = await tx.query(
    `INSERT INTO inspection_quotes (
      quote_no, quote_date, customer_order_no, customer_name, game_title, service_name,
      platform_ios, platform_android, platform_web, platform_other, signed_at, notes,
      internal_order_no, quantity, unit_price_untaxed, total_untaxed, closed_at,
      case_status, billing_status, source_sheet, source_row_no, dedupe_key, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
      userId,
    ]
  );

  return Number(result.insertId);
}

function buildListQuery(filters = {}, { caseOnly = false } = {}) {
  const where = [];
  const params = [];

  const q = sanitizeText(filters.q || filters.keyword, 120);
  if (q) {
    where.push("(quote_no LIKE ? OR customer_name LIKE ? OR customer_order_no LIKE ? OR game_title LIKE ? OR internal_order_no LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const caseStatus = sanitizeText(filters.caseStatus, 20).toUpperCase();
  if (caseStatus) {
    where.push("case_status = ?");
    params.push(caseStatus);
  }

  const billingStatus = sanitizeText(filters.billingStatus, 20).toUpperCase();
  if (billingStatus) {
    where.push("billing_status = ?");
    params.push(billingStatus);
  }

  const month = sanitizeText(filters.month, 7);
  if (/^\d{4}-\d{2}$/.test(month)) {
    where.push("DATE_FORMAT(quote_date, '%Y-%m') = ?");
    params.push(month);
  }

  const customerName = sanitizeText(filters.customerName, 120);
  if (customerName) {
    where.push("customer_name = ?");
    params.push(customerName);
  }

  const platform = sanitizeText(filters.platform, 20).toLowerCase();
  if (platform === "ios") where.push("platform_ios = 1");
  if (platform === "android") where.push("platform_android = 1");
  if (platform === "web") where.push("platform_web = 1");
  if (platform === "other") where.push("platform_other = 1");

  if (caseOnly) {
    where.push("case_status <> 'DRAFT'");
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);

  return {
    sql: `
      SELECT *,
             CASE WHEN signed_at IS NULL THEN NULL ELSE DATEDIFF(signed_at, quote_date) END AS days_to_sign,
             CASE WHEN closed_at IS NULL THEN NULL ELSE DATEDIFF(closed_at, quote_date) END AS days_to_close
      FROM inspection_quotes
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY quote_date DESC, id DESC
      LIMIT ${limit}
    `,
    params,
  };
}

async function listQuotes(filters = {}) {
  const { sql, params } = buildListQuery(filters);
  const rows = await mySqlDb.query(sql, params);
  return rows.map(mapQuoteRow);
}

async function listCases(filters = {}) {
  const { sql, params } = buildListQuery(filters, { caseOnly: true });
  const rows = await mySqlDb.query(sql, params);
  return rows.map((row) => {
    const quote = mapQuoteRow(row);
    return {
      ...quote,
      daysOpen: quote.closedAt
        ? quote.daysToClose
        : Math.max(0, Math.floor((Date.now() - new Date(`${quote.quoteDate}T00:00:00`).getTime()) / 86400000)),
    };
  });
}

async function getQuoteById(id) {
  const row = await findById(id);
  if (!row) throw new HttpError(404, "Quote not found", "QUOTE_NOT_FOUND");
  return mapQuoteRow(row);
}

async function createQuote(user, payload) {
  const normalized = normalizeQuotePayload(payload);
  const id = await mySqlDb.withTransaction((tx) => saveNormalizedQuote(normalized, { userId: user?.id || null, tx }));
  return getQuoteById(id);
}

async function updateQuote(id, user, payload) {
  const existing = await findById(id);
  if (!existing) throw new HttpError(404, "Quote not found", "QUOTE_NOT_FOUND");

  const current = mapQuoteRow(existing);
  const merged = {
    ...current,
    ...payload,
    platforms: payload.platforms || current.platforms,
  };
  const normalized = normalizeQuotePayload(merged);

  await mySqlDb.withTransaction((tx) => saveNormalizedQuote(normalized, { id, userId: user?.id || null, tx }));
  return getQuoteById(id);
}

function assertCaseTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  if (!CASE_STATUS_ORDER.has(currentStatus) || !CASE_STATUS_ORDER.has(nextStatus)) {
    throw new HttpError(400, "Invalid case status", "INVALID_STATUS");
  }
  if (CASE_STATUS_ORDER.get(nextStatus) < CASE_STATUS_ORDER.get(currentStatus)) {
    throw new HttpError(409, "Case status cannot move backwards", "INVALID_CASE_TRANSITION", {
      currentStatus,
      nextStatus,
    });
  }
}

async function updateCaseStatus(id, user, payload = {}) {
  const existing = await findById(id);
  if (!existing) throw new HttpError(404, "Quote not found", "QUOTE_NOT_FOUND");

  const current = mapQuoteRow(existing);
  const nextCaseStatus = payload.caseStatus ? ensureStatus(payload.caseStatus, CASE_STATUSES, "caseStatus") : current.caseStatus;
  assertCaseTransition(current.caseStatus, nextCaseStatus);

  const nextBillingStatus = payload.billingStatus ? ensureStatus(payload.billingStatus, BILLING_STATUSES, "billingStatus") : current.billingStatus;
  const signedAt = payload.signedAt !== undefined ? normalizeDate(payload.signedAt, "signedAt") : current.signedAt;
  const closedAt = payload.closedAt !== undefined
    ? normalizeDate(payload.closedAt, "closedAt")
    : nextCaseStatus === "CLOSED"
      ? (current.closedAt || new Date().toISOString().slice(0, 10))
      : current.closedAt;

  await mySqlDb.query(
    `UPDATE inspection_quotes
     SET case_status = ?, billing_status = ?, signed_at = ?, closed_at = ?, notes = ?, updated_by = ?
     WHERE id = ?`,
    [
      nextCaseStatus,
      nextBillingStatus,
      signedAt,
      closedAt,
      payload.notes !== undefined ? sanitizeText(payload.notes, 4000) : current.notes,
      user?.id || null,
      id,
    ]
  );

  return getQuoteById(id);
}

module.exports = {
  CASE_STATUSES,
  BILLING_STATUSES,
  listQuotes,
  listCases,
  getQuoteById,
  createQuote,
  updateQuote,
  updateCaseStatus,
  saveNormalizedQuote,
  _internals: {
    normalizeDate,
    normalizePlatforms,
    normalizeQuotePayload,
    buildDedupeKey,
    mapQuoteRow,
    buildQuoteNo,
    assertCaseTransition,
  },
};



