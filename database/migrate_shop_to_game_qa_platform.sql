SET @old_db = 'shop';
SET @new_db = 'game_qa_platform';
SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS migrate_shop_to_game_qa_platform;
DELIMITER $$
CREATE PROCEDURE migrate_shop_to_game_qa_platform()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'custaccount'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`custaccount` ',
      '(id, account, password, type, name, cellphone, email, birthday, remark, email_verified_at, is_disabled, disabled_at, disabled_by, disabled_reason, password_reset_at, password_reset_by, create_date, update_date) ',
      'SELECT id, account, password, type, name, cellphone, email, birthday, remark, email_verified_at, is_disabled, disabled_at, disabled_by, disabled_reason, password_reset_at, password_reset_by, create_date, update_date ',
      'FROM `', @old_db, '`.`custaccount`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'roles'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`roles` (id, code, name) ',
      'SELECT id, code, name FROM `', @old_db, '`.`roles`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'permissions'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`permissions` (id, code, name) ',
      'SELECT id, code, name FROM `', @old_db, '`.`permissions`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'user_roles'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`user_roles` (user_id, role_id) ',
      'SELECT user_id, role_id FROM `', @old_db, '`.`user_roles`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'role_permissions'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`role_permissions` (role_id, permission_id) ',
      'SELECT role_id, permission_id FROM `', @old_db, '`.`role_permissions`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'admin_audit_log'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`admin_audit_log` ',
      '(id, actor_user_id, action, target_user_id, ip, user_agent, detail_json, created_at) ',
      'SELECT id, actor_user_id, action, target_user_id, ip, user_agent, detail_json, created_at ',
      'FROM `', @old_db, '`.`admin_audit_log`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'auth_refresh_tokens'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`auth_refresh_tokens` ',
      '(id, user_id, device_id, user_agent, ip, last_used_at, token_hash, jti, expires_at, revoked_at, created_at, updated_at) ',
      'SELECT id, user_id, device_id, user_agent, ip, last_used_at, token_hash, jti, expires_at, revoked_at, created_at, updated_at ',
      'FROM `', @old_db, '`.`auth_refresh_tokens`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'user_email_verify_tokens'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`user_email_verify_tokens` ',
      '(id, user_id, email, token_hash, expires_at, used_at, created_ip, user_agent, created_at) ',
      'SELECT id, user_id, email, token_hash, expires_at, used_at, created_ip, user_agent, created_at ',
      'FROM `', @old_db, '`.`user_email_verify_tokens`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'user_email_verifications'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`user_email_verifications` ',
      '(id, user_id, new_email, token_hash, expires_at, used_at, created_ip, user_agent, created_at) ',
      'SELECT id, user_id, new_email, token_hash, expires_at, used_at, created_ip, user_agent, created_at ',
      'FROM `', @old_db, '`.`user_email_verifications`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'forgot_password_tokens'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`forgot_password_tokens` ',
      '(id, user_id, email, token_hash, expires_at, used_at, created_ip, user_agent, created_at) ',
      'SELECT id, user_id, email, token_hash, expires_at, used_at, created_ip, user_agent, created_at ',
      'FROM `', @old_db, '`.`forgot_password_tokens`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'vendors'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`vendors` ',
      '(id, vendor_code, name, contact_name, contact_phone, contact_email, status, notes, created_by, updated_by, created_at, updated_at) ',
      'SELECT id, vendor_code, name, contact_name, contact_phone, contact_email, status, notes, created_by, updated_by, created_at, updated_at ',
      'FROM `', @old_db, '`.`vendors`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'customers'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`customers` ',
      '(id, customer_code, name, contact_name, contact_phone, contact_email, tax_id, address, status, source_legacy_name, notes, created_by, updated_by, created_at, updated_at) ',
      'SELECT id, customer_code, name, contact_name, contact_phone, contact_email, tax_id, address, status, source_legacy_name, notes, created_by, updated_by, created_at, updated_at ',
      'FROM `', @old_db, '`.`customers`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'games'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`games` ',
      '(id, game_code, title, publisher_name, status, notes, created_by, updated_by, created_at, updated_at) ',
      'SELECT id, game_code, title, publisher_name, status, notes, created_by, updated_by, created_at, updated_at ',
      'FROM `', @old_db, '`.`games`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'inspection_quotes'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`inspection_quotes` ',
      '(id, quote_no, quote_date, customer_order_no, customer_name, game_title, service_name, platform_ios, platform_android, platform_web, platform_other, signed_at, notes, internal_order_no, quantity, unit_price_untaxed, total_untaxed, closed_at, case_status, billing_status, source_sheet, source_row_no, dedupe_key, created_by, updated_by, created_at, updated_at) ',
      'SELECT id, quote_no, quote_date, customer_order_no, customer_name, game_title, service_name, platform_ios, platform_android, platform_web, platform_other, signed_at, notes, internal_order_no, quantity, unit_price_untaxed, total_untaxed, closed_at, case_status, billing_status, source_sheet, source_row_no, dedupe_key, created_by, updated_by, created_at, updated_at ',
      'FROM `', @old_db, '`.`inspection_quotes`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'quotes'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`quotes` ',
      '(id, quote_no, quote_date, customer_id, vendor_id, customer_order_no, service_name, case_status, billing_status, signed_at, closed_at, currency_code, subtotal_untaxed, tax_amount, total_amount, notes, source_sheet, source_row_no, dedupe_key, legacy_inspection_quote_id, created_by, updated_by, created_at, updated_at) ',
      'SELECT id, quote_no, quote_date, customer_id, vendor_id, customer_order_no, service_name, case_status, billing_status, signed_at, closed_at, currency_code, subtotal_untaxed, tax_amount, total_amount, notes, source_sheet, source_row_no, dedupe_key, legacy_inspection_quote_id, created_by, updated_by, created_at, updated_at ',
      'FROM `', @old_db, '`.`quotes`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'quote_items'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`quote_items` ',
      '(id, quote_id, line_no, game_id, game_title_snapshot, quantity, unit_price_untaxed, tax_amount, line_total_untaxed, line_total_amount, notes, created_at, updated_at) ',
      'SELECT id, quote_id, line_no, game_id, game_title_snapshot, quantity, unit_price_untaxed, tax_amount, line_total_untaxed, line_total_amount, notes, created_at, updated_at ',
      'FROM `', @old_db, '`.`quote_items`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'quote_platforms'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`quote_platforms` ',
      '(id, quote_item_id, platform_code, created_at) ',
      'SELECT id, quote_item_id, platform_code, created_at FROM `', @old_db, '`.`quote_platforms`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'quote_status_logs'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`quote_status_logs` ',
      '(id, quote_id, from_status, to_status, from_billing_status, to_billing_status, changed_by, changed_at, note) ',
      'SELECT id, quote_id, from_status, to_status, from_billing_status, to_billing_status, changed_by, changed_at, note ',
      'FROM `', @old_db, '`.`quote_status_logs`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'billing_records'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`billing_records` ',
      '(id, quote_id, billing_no, billing_status, billed_at, settled_at, amount_untaxed, tax_amount, amount_total, note, created_by, updated_by, created_at, updated_at) ',
      'SELECT id, quote_id, billing_no, billing_status, billed_at, settled_at, amount_untaxed, tax_amount, amount_total, note, created_by, updated_by, created_at, updated_at ',
      'FROM `', @old_db, '`.`billing_records`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'quote_attachments'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`quote_attachments` ',
      '(id, quote_id, file_name, file_path, mime_type, file_size, uploaded_by, uploaded_at) ',
      'SELECT id, quote_id, file_name, file_path, mime_type, file_size, uploaded_by, uploaded_at ',
      'FROM `', @old_db, '`.`quote_attachments`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'import_jobs'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`import_jobs` ',
      '(id, import_source_name, file_name, sheet_name, status, total_rows, inserted_rows, updated_rows, failed_rows, error_message, metadata_json, started_by, started_at, finished_at) ',
      'SELECT id, import_source_name, file_name, sheet_name, status, total_rows, inserted_rows, updated_rows, failed_rows, error_message, metadata_json, started_by, started_at, finished_at ',
      'FROM `', @old_db, '`.`import_jobs`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = @old_db AND table_name = 'import_job_rows'
  ) THEN
    SET @sql = CONCAT(
      'INSERT IGNORE INTO `', @new_db, '`.`import_job_rows` ',
      '(id, import_job_id, source_row_no, dedupe_key, result_status, message, payload_json, created_at) ',
      'SELECT id, import_job_id, source_row_no, dedupe_key, result_status, message, payload_json, created_at ',
      'FROM `', @old_db, '`.`import_job_rows`'
    );
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL migrate_shop_to_game_qa_platform();
DROP PROCEDURE IF EXISTS migrate_shop_to_game_qa_platform;

SET FOREIGN_KEY_CHECKS = 1;
