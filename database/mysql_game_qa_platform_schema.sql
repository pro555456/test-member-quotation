SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_schema_migrations_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS custaccount (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account VARCHAR(50) NOT NULL,
  password VARCHAR(255) NOT NULL,
  type CHAR(1) NOT NULL DEFAULT 'U',
  name VARCHAR(50) NOT NULL DEFAULT '',
  cellphone VARCHAR(20) NOT NULL DEFAULT '',
  email VARCHAR(200) NOT NULL,
  birthday DATE NULL,
  remark VARCHAR(500) DEFAULT NULL,
  email_verified_at DATETIME NULL,
  is_disabled TINYINT(1) NOT NULL DEFAULT 0,
  disabled_at DATETIME NULL,
  disabled_by INT UNSIGNED NULL,
  disabled_reason VARCHAR(255) NULL,
  password_reset_at DATETIME NULL,
  password_reset_by INT UNSIGNED NULL,
  create_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_custaccount_account (account),
  UNIQUE KEY uniq_custaccount_email (email),
  UNIQUE KEY uniq_custaccount_cellphone (cellphone),
  KEY idx_custaccount_type (type),
  KEY idx_custaccount_disabled (is_disabled),
  KEY idx_custaccount_disabled_by (disabled_by),
  KEY idx_custaccount_password_reset_by (password_reset_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_permissions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY idx_user_roles_role_id (role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES custaccount(id),
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_role_permissions_permission_id (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id INT UNSIGNED NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_user_id INT UNSIGNED DEFAULT NULL,
  ip VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  detail_json LONGTEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_audit_actor_time (actor_user_id, created_at),
  KEY idx_admin_audit_target_time (target_user_id, created_at),
  KEY idx_admin_audit_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  device_id CHAR(36) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  ip VARCHAR(45) DEFAULT NULL,
  last_used_at DATETIME DEFAULT NULL,
  token_hash VARCHAR(255) NOT NULL,
  jti CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_auth_refresh_tokens_jti (jti),
  KEY idx_auth_refresh_tokens_user_id (user_id),
  KEY idx_auth_refresh_tokens_device_id (device_id),
  KEY idx_auth_refresh_tokens_expires_at (expires_at),
  CONSTRAINT fk_auth_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES custaccount(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_email_verify_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  email VARCHAR(200) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_ip VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_email_verify_token_hash (token_hash),
  KEY idx_user_email_verify_user (user_id, email, used_at),
  KEY idx_user_email_verify_expires_at (expires_at),
  CONSTRAINT fk_user_email_verify_tokens_user FOREIGN KEY (user_id) REFERENCES custaccount(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_email_verifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  new_email VARCHAR(200) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_ip VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_email_verifications_token_hash (token_hash),
  KEY idx_user_email_verifications_user (user_id, used_at),
  KEY idx_user_email_verifications_email (new_email),
  KEY idx_user_email_verifications_expires_at (expires_at),
  CONSTRAINT fk_user_email_verifications_user FOREIGN KEY (user_id) REFERENCES custaccount(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forgot_password_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  email VARCHAR(200) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_ip VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_forgot_password_tokens_hash (token_hash),
  KEY idx_forgot_password_tokens_user (user_id, used_at),
  KEY idx_forgot_password_tokens_expires_at (expires_at),
  CONSTRAINT fk_forgot_password_tokens_user FOREIGN KEY (user_id) REFERENCES custaccount(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quotes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_no VARCHAR(32) NOT NULL,
  quote_number_prefix CHAR(3) DEFAULT NULL,
  quote_sequence_no INT UNSIGNED DEFAULT NULL,
  quote_version_no INT UNSIGNED NOT NULL DEFAULT 1,
  quote_number_date DATE DEFAULT NULL,
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
  KEY idx_quotes_number_date_sequence (quote_number_date, quote_sequence_no),
  KEY idx_quotes_vendor (vendor_id),
  KEY idx_quotes_case_status (case_status),
  KEY idx_quotes_billing_status (billing_status),
  KEY idx_quotes_signed_at (signed_at),
  KEY idx_quotes_closed_at (closed_at),
  CONSTRAINT fk_quotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_quotes_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_quotes_legacy FOREIGN KEY (legacy_inspection_quote_id) REFERENCES inspection_quotes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote_platforms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_item_id BIGINT UNSIGNED NOT NULL,
  platform_code VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_quote_platforms_item_code (quote_item_id, platform_code),
  KEY idx_quote_platforms_code (platform_code),
  CONSTRAINT fk_quote_platforms_item FOREIGN KEY (quote_item_id) REFERENCES quote_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO roles (code, name) VALUES
  ('admin', 'Administrator'),
  ('manager', 'Manager'),
  ('sales', 'Sales'),
  ('operator', 'Operator'),
  ('customer', 'Customer');

INSERT IGNORE INTO permissions (code, name) VALUES
  ('admin:access', 'Admin access'),
  ('dashboard:read', 'View dashboard'),
  ('analytics:read', 'View analytics'),
  ('quote:read', 'Read quotations'),
  ('quote:write', 'Manage quotations'),
  ('case:read', 'Read inspection cases'),
  ('case:write', 'Manage inspection cases'),
  ('settlement:manage', 'Manage settlements'),
  ('customer:read', 'Read customers'),
  ('customer:write', 'Manage customers'),
  ('import:manage', 'Manage imports'),
  ('attachment:write', 'Manage attachments'),
  ('user:manage', 'Manage users');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
WHERE r.code = 'admin';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('dashboard:read', 'analytics:read', 'quote:read', 'quote:write', 'case:read', 'case:write', 'settlement:manage', 'customer:read', 'customer:write', 'import:manage', 'attachment:write')
WHERE r.code = 'manager';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('dashboard:read', 'quote:read', 'quote:write', 'case:read', 'customer:read', 'customer:write', 'attachment:write')
WHERE r.code = 'sales';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('dashboard:read', 'quote:read', 'case:read', 'case:write', 'attachment:write')
WHERE r.code = 'operator';

SET FOREIGN_KEY_CHECKS = 1;
