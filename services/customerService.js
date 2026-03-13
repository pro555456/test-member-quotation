const mySqlDb = require('../connection/mySqlConnection');
const { HttpError } = require('../utils/http');

function sanitizeText(value, max = 255) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeCustomerPayload(payload = {}) {
  const customerId = payload.customerId || payload.id ? Number(payload.customerId || payload.id) : null;
  const name = sanitizeText(payload.name || payload.customerName, 120);
  const contactName = sanitizeText(payload.contactName || payload.customerContactName, 120) || null;
  const contactEmail = sanitizeText(payload.contactEmail || payload.customerContactEmail, 200) || null;
  const billingEmail = sanitizeText(payload.billingEmail, 200) || null;
  const contactPhone = sanitizeText(payload.contactPhone || payload.customerContactPhone, 30) || null;
  const notes = sanitizeText(payload.notes, 1000) || null;

  if (!customerId && !name) {
    throw new HttpError(400, 'customer name is required', 'VALIDATION_ERROR');
  }

  return {
    customerId: Number.isFinite(customerId) && customerId > 0 ? customerId : null,
    name,
    contactName,
    contactEmail,
    billingEmail,
    contactPhone,
    notes,
  };
}

function mapCustomer(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    billingEmail: row.billing_email,
    contactPhone: row.contact_phone,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCustomerById(id, { tx = mySqlDb } = {}) {
  const row = await tx.queryOne('SELECT * FROM customers WHERE id = ? LIMIT 1', [id]);
  if (!row) throw new HttpError(404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
  return mapCustomer(row);
}

async function listCustomers(filters = {}, { tx = mySqlDb } = {}) {
  const keyword = sanitizeText(filters.keyword || filters.q, 120);
  const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
  const where = ['status <> ?'];
  const params = ['archived'];

  if (keyword) {
    where.push('(name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ? OR billing_email LIKE ? OR contact_phone LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const rows = await tx.query(
    `SELECT *
     FROM customers
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit}`,
    params
  );

  return rows.map(mapCustomer);
}

async function ensureCustomer(user, payload = {}, { tx = mySqlDb } = {}) {
  const normalized = normalizeCustomerPayload(payload);
  let row = null;

  if (normalized.customerId) {
    row = await tx.queryOne('SELECT * FROM customers WHERE id = ? LIMIT 1', [normalized.customerId]);
    if (!row) throw new HttpError(404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
  } else {
    row = await tx.queryOne('SELECT * FROM customers WHERE name = ? LIMIT 1', [normalized.name]);
  }

  if (!row) {
    const result = await tx.query(
      `INSERT INTO customers (
        customer_code, name, contact_name, contact_email, billing_email, contact_phone,
        status, notes, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        null,
        normalized.name,
        normalized.contactName,
        normalized.contactEmail,
        normalized.billingEmail || normalized.contactEmail,
        normalized.contactPhone,
        normalized.notes,
        user?.id || null,
        user?.id || null,
      ]
    );

    return getCustomerById(Number(result.insertId), { tx });
  }

  const nextName = normalized.name || row.name;
  const nextContactName = normalized.contactName || row.contact_name || null;
  const nextContactEmail = normalized.contactEmail || row.contact_email || null;
  const nextBillingEmail = normalized.billingEmail || row.billing_email || nextContactEmail || null;
  const nextPhone = normalized.contactPhone || row.contact_phone || null;
  const nextNotes = normalized.notes !== null ? normalized.notes : row.notes;

  await tx.query(
    `UPDATE customers
     SET name = ?,
         contact_name = ?,
         contact_email = ?,
         billing_email = ?,
         contact_phone = ?,
         notes = ?,
         updated_by = ?
     WHERE id = ?`,
    [nextName, nextContactName, nextContactEmail, nextBillingEmail, nextPhone, nextNotes, user?.id || null, row.id]
  );

  return getCustomerById(row.id, { tx });
}

async function createCustomer(user, payload = {}) {
  return ensureCustomer(user, payload, { tx: mySqlDb });
}

module.exports = {
  listCustomers,
  getCustomerById,
  createCustomer,
  ensureCustomer,
  _internals: {
    normalizeCustomerPayload,
    mapCustomer,
  },
};
