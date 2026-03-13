USE game_qa_platform;

ALTER TABLE customers
  ADD COLUMN billing_email VARCHAR(200) NULL AFTER contact_email;

ALTER TABLE quotes
  ADD COLUMN sales_owner_user_id INT UNSIGNED NULL AFTER vendor_id,
  ADD COLUMN internal_order_no VARCHAR(64) NULL AFTER customer_order_no,
  ADD COLUMN customer_contact_name VARCHAR(120) NULL AFTER internal_order_no,
  ADD COLUMN customer_contact_email VARCHAR(200) NULL AFTER customer_contact_name,
  ADD COLUMN pdf_attachment_id BIGINT UNSIGNED NULL AFTER legacy_inspection_quote_id,
  ADD COLUMN last_sent_at DATETIME NULL AFTER pdf_attachment_id,
  ADD COLUMN last_sent_to VARCHAR(200) NULL AFTER last_sent_at,
  ADD COLUMN last_sent_cc VARCHAR(500) NULL AFTER last_sent_to;

ALTER TABLE quotes
  ADD UNIQUE KEY uniq_quotes_internal_order_no (internal_order_no),
  ADD KEY idx_quotes_sales_owner (sales_owner_user_id),
  ADD KEY idx_quotes_pdf_attachment (pdf_attachment_id);

ALTER TABLE quote_items
  ADD COLUMN other_price_untaxed DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER unit_price_untaxed,
  ADD COLUMN pricing_breakdown_json LONGTEXT NULL AFTER other_price_untaxed;

ALTER TABLE quote_attachments
  ADD COLUMN attachment_kind VARCHAR(30) NOT NULL DEFAULT 'file' AFTER mime_type,
  ADD KEY idx_quote_attachments_quote_kind (quote_id, attachment_kind);

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE customers
SET billing_email = contact_email
WHERE (billing_email IS NULL OR billing_email = '')
  AND contact_email IS NOT NULL
  AND contact_email <> '';

UPDATE quotes q
INNER JOIN inspection_quotes iq ON iq.id = q.legacy_inspection_quote_id
LEFT JOIN customers c ON c.id = q.customer_id
SET q.internal_order_no = COALESCE(q.internal_order_no, iq.internal_order_no),
    q.customer_contact_name = COALESCE(q.customer_contact_name, NULLIF(iq.customer_name, '')),
    q.customer_contact_email = COALESCE(q.customer_contact_email, c.contact_email, c.billing_email)
WHERE q.legacy_inspection_quote_id IS NOT NULL;

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
  AND (qi.pricing_breakdown_json IS NULL OR qi.pricing_breakdown_json = '');

INSERT IGNORE INTO permissions (code, name)
VALUES ('quote:send', 'Send quotation email');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.code = 'quote:send'
WHERE r.code IN ('admin', 'manager', 'sales');
