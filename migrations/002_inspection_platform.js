async function ensurePermission(tx, code, name) {
  await tx.query(
    "INSERT IGNORE INTO permissions (code, name) VALUES (?, ?)",
    [code, name]
  );
}

async function assignRolePermissions(tx, roleCode, permissionCodes) {
  const roles = await tx.query("SELECT id FROM roles WHERE code = ? LIMIT 1", [roleCode]);
  if (!roles.length) return;

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
  name: "002_inspection_platform",
  async up(tx) {
    await tx.query(`
      CREATE TABLE IF NOT EXISTS inspection_quotes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_no VARCHAR(32) NOT NULL,
        quote_date DATE NOT NULL,
        customer_order_no VARCHAR(64) DEFAULT NULL,
        customer_name VARCHAR(120) NOT NULL,
        game_title VARCHAR(255) NOT NULL,
        service_name VARCHAR(255) DEFAULT NULL,
        platform_ios TINYINT(1) NOT NULL DEFAULT 0,
        platform_android TINYINT(1) NOT NULL DEFAULT 0,
        platform_web TINYINT(1) NOT NULL DEFAULT 0,
        platform_other TINYINT(1) NOT NULL DEFAULT 0,
        signed_at DATE DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        internal_order_no VARCHAR(64) DEFAULT NULL,
        quantity INT NOT NULL DEFAULT 1,
        unit_price_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0,
        closed_at DATE DEFAULT NULL,
        case_status VARCHAR(20) NOT NULL DEFAULT 'QUOTED',
        billing_status VARCHAR(20) NOT NULL DEFAULT 'UNBILLED',
        source_sheet VARCHAR(64) DEFAULT NULL,
        source_row_no INT DEFAULT NULL,
        dedupe_key VARCHAR(191) NOT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        updated_by INT UNSIGNED DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_inspection_quotes_quote_no (quote_no),
        UNIQUE KEY uniq_inspection_quotes_dedupe_key (dedupe_key),
        KEY idx_inspection_quotes_quote_date (quote_date),
        KEY idx_inspection_quotes_customer_name (customer_name),
        KEY idx_inspection_quotes_case_status (case_status),
        KEY idx_inspection_quotes_billing_status (billing_status),
        KEY idx_inspection_quotes_closed_at (closed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensurePermission(tx, "dashboard:read", "View dashboard");
    await ensurePermission(tx, "quote:read", "Read quotations");
    await ensurePermission(tx, "quote:write", "Manage quotations");
    await ensurePermission(tx, "case:read", "Read inspection cases");
    await ensurePermission(tx, "case:write", "Manage inspection cases");
    await ensurePermission(tx, "settlement:manage", "Manage settlements");

    await assignRolePermissions(tx, "admin", [
      "dashboard:read",
      "quote:read",
      "quote:write",
      "case:read",
      "case:write",
      "settlement:manage",
    ]);
  },
};
