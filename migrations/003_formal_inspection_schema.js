async function ensurePermission(tx, code, name) {
  await tx.query("INSERT IGNORE INTO permissions (code, name) VALUES (?, ?)", [code, name]);
}

async function ensureRole(tx, code, name) {
  await tx.query("INSERT IGNORE INTO roles (code, name) VALUES (?, ?)", [code, name]);
}

async function assignRolePermissions(tx, roleCode, permissionCodes) {
  const roles = await tx.query("SELECT id FROM roles WHERE code = ? LIMIT 1", [roleCode]);
  if (!roles.length || !permissionCodes.length) return;

  const permissions = await tx.query(
    `SELECT id FROM permissions WHERE code IN (${permissionCodes.map(() => "?").join(",")})`,
    permissionCodes
  );

  for (const permission of permissions) {
    await tx.query(
      "INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [roles[0].id, permission.id]
    );
  }
}

module.exports = {
  name: "003_formal_inspection_schema",
  async up(tx) {
    await tx.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        vendor_code VARCHAR(32) DEFAULT NULL,
        name VARCHAR(120) NOT NULL,
        contact_name VARCHAR(120) DEFAULT NULL,
        contact_phone VARCHAR(30) DEFAULT NULL,
        contact_email VARCHAR(200) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        notes TEXT DEFAULT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        updated_by INT UNSIGNED DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_vendors_code (vendor_code),
        UNIQUE KEY uniq_vendors_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        customer_code VARCHAR(32) DEFAULT NULL,
        name VARCHAR(120) NOT NULL,
        contact_name VARCHAR(120) DEFAULT NULL,
        contact_phone VARCHAR(30) DEFAULT NULL,
        contact_email VARCHAR(200) DEFAULT NULL,
        tax_id VARCHAR(32) DEFAULT NULL,
        address VARCHAR(255) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        source_legacy_name VARCHAR(120) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        updated_by INT UNSIGNED DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_customers_code (customer_code),
        UNIQUE KEY uniq_customers_name (name),
        KEY idx_customers_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS games (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        game_code VARCHAR(32) DEFAULT NULL,
        title VARCHAR(255) NOT NULL,
        publisher_name VARCHAR(120) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        notes TEXT DEFAULT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        updated_by INT UNSIGNED DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_games_code (game_code),
        UNIQUE KEY uniq_games_title (title),
        KEY idx_games_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_no VARCHAR(32) NOT NULL,
        quote_date DATE NOT NULL,
        customer_id BIGINT UNSIGNED NOT NULL,
        vendor_id BIGINT UNSIGNED DEFAULT NULL,
        customer_order_no VARCHAR(64) DEFAULT NULL,
        service_name VARCHAR(255) DEFAULT NULL,
        case_status VARCHAR(20) NOT NULL DEFAULT 'QUOTED',
        billing_status VARCHAR(20) NOT NULL DEFAULT 'UNBILLED',
        signed_at DATE DEFAULT NULL,
        closed_at DATE DEFAULT NULL,
        currency_code CHAR(3) NOT NULL DEFAULT 'TWD',
        subtotal_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT DEFAULT NULL,
        source_sheet VARCHAR(64) DEFAULT NULL,
        source_row_no INT DEFAULT NULL,
        dedupe_key VARCHAR(191) DEFAULT NULL,
        legacy_inspection_quote_id BIGINT UNSIGNED DEFAULT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        updated_by INT UNSIGNED DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_quotes_quote_no (quote_no),
        UNIQUE KEY uniq_quotes_dedupe_key (dedupe_key),
        UNIQUE KEY uniq_quotes_legacy_inspection_quote (legacy_inspection_quote_id),
        KEY idx_quotes_customer_date (customer_id, quote_date),
        KEY idx_quotes_vendor (vendor_id),
        KEY idx_quotes_case_status (case_status),
        KEY idx_quotes_billing_status (billing_status),
        KEY idx_quotes_signed_at (signed_at),
        KEY idx_quotes_closed_at (closed_at),
        CONSTRAINT fk_quotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
        CONSTRAINT fk_quotes_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
        CONSTRAINT fk_quotes_legacy FOREIGN KEY (legacy_inspection_quote_id) REFERENCES inspection_quotes(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS quote_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_id BIGINT UNSIGNED NOT NULL,
        line_no INT NOT NULL DEFAULT 1,
        game_id BIGINT UNSIGNED DEFAULT NULL,
        game_title_snapshot VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        unit_price_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        line_total_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0,
        line_total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_quote_items_quote_line (quote_id, line_no),
        KEY idx_quote_items_game (game_id),
        CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
        CONSTRAINT fk_quote_items_game FOREIGN KEY (game_id) REFERENCES games(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS quote_platforms (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_item_id BIGINT UNSIGNED NOT NULL,
        platform_code VARCHAR(16) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_quote_platforms_item_code (quote_item_id, platform_code),
        KEY idx_quote_platforms_code (platform_code),
        CONSTRAINT fk_quote_platforms_item FOREIGN KEY (quote_item_id) REFERENCES quote_items(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS quote_status_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_id BIGINT UNSIGNED NOT NULL,
        from_status VARCHAR(20) DEFAULT NULL,
        to_status VARCHAR(20) NOT NULL,
        from_billing_status VARCHAR(20) DEFAULT NULL,
        to_billing_status VARCHAR(20) DEFAULT NULL,
        changed_by INT UNSIGNED DEFAULT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        note VARCHAR(255) DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_quote_status_logs_quote_time (quote_id, changed_at),
        CONSTRAINT fk_quote_status_logs_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS billing_records (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_id BIGINT UNSIGNED NOT NULL,
        billing_no VARCHAR(32) DEFAULT NULL,
        billing_status VARCHAR(20) NOT NULL DEFAULT 'UNBILLED',
        billed_at DATETIME DEFAULT NULL,
        settled_at DATETIME DEFAULT NULL,
        amount_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        amount_total DECIMAL(12,2) NOT NULL DEFAULT 0,
        note VARCHAR(255) DEFAULT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        updated_by INT UNSIGNED DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_billing_records_no (billing_no),
        UNIQUE KEY uniq_billing_records_quote (quote_id),
        KEY idx_billing_records_status (billing_status),
        CONSTRAINT fk_billing_records_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS quote_attachments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_id BIGINT UNSIGNED NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        mime_type VARCHAR(120) DEFAULT NULL,
        file_size BIGINT UNSIGNED DEFAULT NULL,
        uploaded_by INT UNSIGNED DEFAULT NULL,
        uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_quote_attachments_quote (quote_id),
        CONSTRAINT fk_quote_attachments_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        import_source_name VARCHAR(120) DEFAULT NULL,
        file_name VARCHAR(255) NOT NULL,
        sheet_name VARCHAR(64) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        total_rows INT NOT NULL DEFAULT 0,
        inserted_rows INT NOT NULL DEFAULT 0,
        updated_rows INT NOT NULL DEFAULT 0,
        failed_rows INT NOT NULL DEFAULT 0,
        error_message TEXT DEFAULT NULL,
        metadata_json LONGTEXT DEFAULT NULL,
        started_by INT UNSIGNED DEFAULT NULL,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at DATETIME DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_import_jobs_status_started (status, started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await tx.query(`
      CREATE TABLE IF NOT EXISTS import_job_rows (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        import_job_id BIGINT UNSIGNED NOT NULL,
        source_row_no INT DEFAULT NULL,
        dedupe_key VARCHAR(191) DEFAULT NULL,
        result_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        message VARCHAR(255) DEFAULT NULL,
        payload_json LONGTEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_import_job_rows_job (import_job_id),
        KEY idx_import_job_rows_status (result_status),
        CONSTRAINT fk_import_job_rows_job FOREIGN KEY (import_job_id) REFERENCES import_jobs(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensureRole(tx, "manager", "Manager");
    await ensureRole(tx, "sales", "Sales");
    await ensureRole(tx, "operator", "Operator");

    await ensurePermission(tx, "analytics:read", "View analytics");
    await ensurePermission(tx, "customer:read", "Read customers");
    await ensurePermission(tx, "customer:write", "Manage customers");
    await ensurePermission(tx, "import:manage", "Manage imports");
    await ensurePermission(tx, "attachment:write", "Manage attachments");

    await assignRolePermissions(tx, "admin", [
      "dashboard:read",
      "analytics:read",
      "quote:read",
      "quote:write",
      "case:read",
      "case:write",
      "settlement:manage",
      "customer:read",
      "customer:write",
      "import:manage",
      "attachment:write",
      "user:manage",
    ]);

    await assignRolePermissions(tx, "manager", [
      "dashboard:read",
      "analytics:read",
      "quote:read",
      "quote:write",
      "case:read",
      "case:write",
      "settlement:manage",
      "customer:read",
      "customer:write",
      "import:manage",
      "attachment:write",
    ]);

    await assignRolePermissions(tx, "sales", [
      "dashboard:read",
      "quote:read",
      "quote:write",
      "case:read",
      "customer:read",
      "customer:write",
      "attachment:write",
    ]);

    await assignRolePermissions(tx, "operator", [
      "dashboard:read",
      "quote:read",
      "case:read",
      "case:write",
      "attachment:write",
    ]);

    await tx.query(`
      INSERT INTO customers (customer_code, name, source_legacy_name, status, created_at, updated_at)
      SELECT
        CONCAT('LEGACY-CUST-', LPAD(MIN(iq.id), 6, '0')),
        iq.customer_name,
        iq.customer_name,
        'active',
        NOW(),
        NOW()
      FROM inspection_quotes iq
      LEFT JOIN customers c ON c.name = iq.customer_name
      WHERE iq.customer_name IS NOT NULL
        AND iq.customer_name <> ''
        AND c.id IS NULL
      GROUP BY iq.customer_name
    `);

    await tx.query(`
      INSERT INTO games (game_code, title, status, created_at, updated_at)
      SELECT
        CONCAT('LEGACY-GAME-', LPAD(MIN(iq.id), 6, '0')),
        iq.game_title,
        'active',
        NOW(),
        NOW()
      FROM inspection_quotes iq
      LEFT JOIN games g ON g.title = iq.game_title
      WHERE iq.game_title IS NOT NULL
        AND iq.game_title <> ''
        AND g.id IS NULL
      GROUP BY iq.game_title
    `);

    await tx.query(`
      INSERT INTO quotes (
        quote_no, quote_date, customer_id, vendor_id, customer_order_no, service_name,
        case_status, billing_status, signed_at, closed_at, currency_code,
        subtotal_untaxed, tax_amount, total_amount, notes, source_sheet, source_row_no,
        dedupe_key, legacy_inspection_quote_id, created_by, updated_by, created_at, updated_at
      )
      SELECT
        iq.quote_no,
        iq.quote_date,
        c.id,
        NULL,
        iq.customer_order_no,
        iq.service_name,
        COALESCE(NULLIF(iq.case_status, ''), 'QUOTED'),
        COALESCE(NULLIF(iq.billing_status, ''), 'UNBILLED'),
        iq.signed_at,
        iq.closed_at,
        'TWD',
        iq.total_untaxed,
        0,
        iq.total_untaxed,
        iq.notes,
        iq.source_sheet,
        iq.source_row_no,
        iq.dedupe_key,
        iq.id,
        iq.created_by,
        iq.updated_by,
        COALESCE(iq.created_at, NOW()),
        COALESCE(iq.updated_at, NOW())
      FROM inspection_quotes iq
      INNER JOIN customers c ON c.name = iq.customer_name
      LEFT JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
      WHERE q.id IS NULL
    `);

    await tx.query(`
      INSERT INTO quote_items (
        quote_id, line_no, game_id, game_title_snapshot, quantity,
        unit_price_untaxed, tax_amount, line_total_untaxed, line_total_amount,
        notes, created_at, updated_at
      )
      SELECT
        q.id,
        1,
        g.id,
        iq.game_title,
        iq.quantity,
        iq.unit_price_untaxed,
        0,
        iq.total_untaxed,
        iq.total_untaxed,
        iq.notes,
        COALESCE(iq.created_at, NOW()),
        COALESCE(iq.updated_at, NOW())
      FROM inspection_quotes iq
      INNER JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
      LEFT JOIN games g ON g.title = iq.game_title
      LEFT JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
      WHERE qi.id IS NULL
    `);

    await tx.query(`
      INSERT INTO quote_platforms (quote_item_id, platform_code, created_at)
      SELECT qi.id, 'IOS', COALESCE(iq.created_at, NOW())
      FROM inspection_quotes iq
      INNER JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
      INNER JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
      LEFT JOIN quote_platforms qp ON qp.quote_item_id = qi.id AND qp.platform_code = 'IOS'
      WHERE iq.platform_ios = 1 AND qp.id IS NULL
    `);

    await tx.query(`
      INSERT INTO quote_platforms (quote_item_id, platform_code, created_at)
      SELECT qi.id, 'ANDROID', COALESCE(iq.created_at, NOW())
      FROM inspection_quotes iq
      INNER JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
      INNER JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
      LEFT JOIN quote_platforms qp ON qp.quote_item_id = qi.id AND qp.platform_code = 'ANDROID'
      WHERE iq.platform_android = 1 AND qp.id IS NULL
    `);

    await tx.query(`
      INSERT INTO quote_platforms (quote_item_id, platform_code, created_at)
      SELECT qi.id, 'WEB', COALESCE(iq.created_at, NOW())
      FROM inspection_quotes iq
      INNER JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
      INNER JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
      LEFT JOIN quote_platforms qp ON qp.quote_item_id = qi.id AND qp.platform_code = 'WEB'
      WHERE iq.platform_web = 1 AND qp.id IS NULL
    `);

    await tx.query(`
      INSERT INTO quote_platforms (quote_item_id, platform_code, created_at)
      SELECT qi.id, 'OTHER', COALESCE(iq.created_at, NOW())
      FROM inspection_quotes iq
      INNER JOIN quotes q ON q.legacy_inspection_quote_id = iq.id
      INNER JOIN quote_items qi ON qi.quote_id = q.id AND qi.line_no = 1
      LEFT JOIN quote_platforms qp ON qp.quote_item_id = qi.id AND qp.platform_code = 'OTHER'
      WHERE iq.platform_other = 1 AND qp.id IS NULL
    `);

    await tx.query(`
      INSERT INTO quote_status_logs (
        quote_id, from_status, to_status, from_billing_status, to_billing_status, changed_by, changed_at, note
      )
      SELECT
        q.id,
        NULL,
        q.case_status,
        NULL,
        q.billing_status,
        COALESCE(q.updated_by, q.created_by),
        COALESCE(q.updated_at, q.created_at, NOW()),
        'Backfilled from inspection_quotes'
      FROM quotes q
      LEFT JOIN quote_status_logs qsl ON qsl.quote_id = q.id
      WHERE q.legacy_inspection_quote_id IS NOT NULL
        AND qsl.id IS NULL
    `);

    await tx.query(`
      INSERT INTO billing_records (
        quote_id, billing_no, billing_status, billed_at, settled_at,
        amount_untaxed, tax_amount, amount_total, note,
        created_by, updated_by, created_at, updated_at
      )
      SELECT
        q.id,
        CASE
          WHEN q.billing_status IN ('BILLED', 'SETTLED') THEN CONCAT('LEGACY-BILL-', LPAD(q.id, 8, '0'))
          ELSE NULL
        END,
        q.billing_status,
        CASE
          WHEN q.billing_status IN ('BILLED', 'SETTLED') THEN COALESCE(q.signed_at, q.updated_at, q.created_at)
          ELSE NULL
        END,
        CASE
          WHEN q.billing_status = 'SETTLED' THEN COALESCE(q.closed_at, q.updated_at, q.created_at)
          ELSE NULL
        END,
        q.subtotal_untaxed,
        q.tax_amount,
        q.total_amount,
        'Backfilled from inspection_quotes',
        q.created_by,
        q.updated_by,
        COALESCE(q.created_at, NOW()),
        COALESCE(q.updated_at, NOW())
      FROM quotes q
      LEFT JOIN billing_records br ON br.quote_id = q.id
      WHERE q.legacy_inspection_quote_id IS NOT NULL
        AND br.id IS NULL
    `);
  },
};
