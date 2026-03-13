async function ensurePermission(tx, code, name) {
  await tx.query('INSERT IGNORE INTO permissions (code, name) VALUES (?, ?)', [code, name]);
}

async function columnExists(tx, tableName, columnName) {
  const row = await tx.queryOne(
    `SELECT 1 AS hit
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return !!row;
}

async function indexExists(tx, tableName, indexName) {
  const row = await tx.queryOne(
    `SELECT 1 AS hit
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return !!row;
}

async function addColumnIfMissing(tx, tableName, columnName, definition) {
  if (await columnExists(tx, tableName, columnName)) return;
  await tx.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function addIndexIfMissing(tx, tableName, indexName, definition) {
  if (await indexExists(tx, tableName, indexName)) return;
  await tx.query(`ALTER TABLE ${tableName} ADD ${definition}`);
}

async function assignRolePermissions(tx, roleCode, permissionCodes) {
  const role = await tx.queryOne('SELECT id FROM roles WHERE code = ? LIMIT 1', [roleCode]);
  if (!role || !permissionCodes.length) return;

  const permissions = await tx.query(
    `SELECT id FROM permissions WHERE code IN (${permissionCodes.map(() => '?').join(',')})`,
    permissionCodes
  );

  for (const permission of permissions) {
    await tx.query(
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [role.id, permission.id]
    );
  }
}

module.exports = {
  name: '004_quote_delivery_flow',
  async up(tx) {
    await addColumnIfMissing(tx, 'customers', 'billing_email', 'VARCHAR(200) DEFAULT NULL AFTER contact_email');

    await addColumnIfMissing(tx, 'quotes', 'sales_owner_user_id', 'INT UNSIGNED DEFAULT NULL AFTER vendor_id');
    await addColumnIfMissing(tx, 'quotes', 'internal_order_no', 'VARCHAR(64) DEFAULT NULL AFTER customer_order_no');
    await addColumnIfMissing(tx, 'quotes', 'customer_contact_name', 'VARCHAR(120) DEFAULT NULL AFTER internal_order_no');
    await addColumnIfMissing(tx, 'quotes', 'customer_contact_email', 'VARCHAR(200) DEFAULT NULL AFTER customer_contact_name');
    await addColumnIfMissing(tx, 'quotes', 'pdf_attachment_id', 'BIGINT UNSIGNED DEFAULT NULL AFTER legacy_inspection_quote_id');
    await addColumnIfMissing(tx, 'quotes', 'last_sent_at', 'DATETIME DEFAULT NULL AFTER pdf_attachment_id');
    await addColumnIfMissing(tx, 'quotes', 'last_sent_to', 'VARCHAR(200) DEFAULT NULL AFTER last_sent_at');
    await addColumnIfMissing(tx, 'quotes', 'last_sent_cc', 'VARCHAR(500) DEFAULT NULL AFTER last_sent_to');

    await addIndexIfMissing(tx, 'quotes', 'uniq_quotes_internal_order_no', 'UNIQUE KEY uniq_quotes_internal_order_no (internal_order_no)');
    await addIndexIfMissing(tx, 'quotes', 'idx_quotes_sales_owner', 'KEY idx_quotes_sales_owner (sales_owner_user_id)');
    await addIndexIfMissing(tx, 'quotes', 'idx_quotes_pdf_attachment', 'KEY idx_quotes_pdf_attachment (pdf_attachment_id)');

    await addColumnIfMissing(tx, 'quote_items', 'other_price_untaxed', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER unit_price_untaxed');
    await addColumnIfMissing(tx, 'quote_items', 'pricing_breakdown_json', 'LONGTEXT DEFAULT NULL AFTER other_price_untaxed');

    await addColumnIfMissing(tx, 'quote_attachments', 'attachment_kind', "VARCHAR(30) NOT NULL DEFAULT 'file' AFTER mime_type");
    await addIndexIfMissing(tx, 'quote_attachments', 'idx_quote_attachments_quote_kind', 'KEY idx_quote_attachments_quote_kind (quote_id, attachment_kind)');

    await tx.query(`
      CREATE TABLE IF NOT EXISTS quote_send_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_id BIGINT UNSIGNED NOT NULL,
        subject VARCHAR(255) NOT NULL,
        recipient_to VARCHAR(500) NOT NULL,
        recipient_cc VARCHAR(500) DEFAULT NULL,
        attachment_name VARCHAR(255) DEFAULT NULL,
        message_html LONGTEXT DEFAULT NULL,
        sent_by INT UNSIGNED DEFAULT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        send_status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
        provider_message_id VARCHAR(255) DEFAULT NULL,
        provider_response TEXT DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_quote_send_logs_quote_time (quote_id, sent_at),
        CONSTRAINT fk_quote_send_logs_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensurePermission(tx, 'quote:send', 'Send quotation email');
    await assignRolePermissions(tx, 'admin', ['quote:send']);
    await assignRolePermissions(tx, 'manager', ['quote:send']);
    await assignRolePermissions(tx, 'sales', ['quote:send']);

    await tx.query(`
      UPDATE quotes q
      INNER JOIN inspection_quotes iq ON iq.id = q.legacy_inspection_quote_id
      LEFT JOIN customers c ON c.id = q.customer_id
      SET q.internal_order_no = COALESCE(q.internal_order_no, iq.internal_order_no),
          q.customer_contact_name = COALESCE(q.customer_contact_name, NULLIF(iq.customer_name, '')),
          q.customer_contact_email = COALESCE(q.customer_contact_email, c.contact_email, c.billing_email)
      WHERE q.legacy_inspection_quote_id IS NOT NULL
    `);

    await tx.query(`
      UPDATE quote_items qi
      INNER JOIN quotes q ON q.id = qi.quote_id
      INNER JOIN inspection_quotes iq ON iq.id = q.legacy_inspection_quote_id
      SET qi.other_price_untaxed = GREATEST(0, iq.unit_price_untaxed
          - (CASE WHEN iq.platform_ios = 1 THEN 20000 ELSE 0 END)
          - (CASE WHEN iq.platform_android = 1 THEN 20000 ELSE 0 END)
          - (CASE WHEN iq.platform_web = 1 THEN 40000 ELSE 0 END)),
          qi.pricing_breakdown_json = JSON_OBJECT(
            'ios', CASE WHEN iq.platform_ios = 1 THEN 20000 ELSE 0 END,
            'android', CASE WHEN iq.platform_android = 1 THEN 20000 ELSE 0 END,
            'web', CASE WHEN iq.platform_web = 1 THEN 40000 ELSE 0 END,
            'other', GREATEST(0, iq.unit_price_untaxed
              - (CASE WHEN iq.platform_ios = 1 THEN 20000 ELSE 0 END)
              - (CASE WHEN iq.platform_android = 1 THEN 20000 ELSE 0 END)
              - (CASE WHEN iq.platform_web = 1 THEN 40000 ELSE 0 END)),
            'quantity', iq.quantity,
            'unitPriceUntaxed', iq.unit_price_untaxed,
            'totalUntaxed', iq.total_untaxed
          )
      WHERE q.legacy_inspection_quote_id IS NOT NULL
        AND qi.line_no = 1
        AND (qi.pricing_breakdown_json IS NULL OR qi.pricing_breakdown_json = '')
    `);
  },
};
