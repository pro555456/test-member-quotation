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

module.exports = {
  name: '006_yunjia_branding_quote_numbering',
  async up(tx) {
    await addColumnIfMissing(tx, 'quotes', 'quote_number_prefix', 'CHAR(3) DEFAULT NULL AFTER quote_no');
    await addColumnIfMissing(tx, 'quotes', 'quote_sequence_no', 'INT UNSIGNED DEFAULT NULL AFTER quote_number_prefix');
    await addColumnIfMissing(tx, 'quotes', 'quote_version_no', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER quote_sequence_no');
    await addColumnIfMissing(tx, 'quotes', 'quote_number_date', 'DATE DEFAULT NULL AFTER quote_version_no');

    await addIndexIfMissing(tx, 'quotes', 'idx_quotes_number_date_sequence', 'KEY idx_quotes_number_date_sequence (quote_number_date, quote_sequence_no)');

    await tx.query(`
      UPDATE quotes
      SET quote_version_no = COALESCE(NULLIF(quote_version_no, 0), 1),
          quote_number_date = COALESCE(quote_number_date, quote_date)
      WHERE quote_number_date IS NULL OR quote_version_no IS NULL OR quote_version_no = 0
    `);
  },
};
