const fs = require('node:fs');
const path = require('node:path');
const db = require('../connection/mySqlConnection');

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(191) NOT NULL,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_app_migrations_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getExecutedMigrationNames() {
  const rows = await db.query('SELECT name FROM app_migrations ORDER BY name');
  return new Set(rows.map((row) => row.name));
}

function loadMigrationModules() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+.*\.js$/.test(file))
    .sort()
    .map((file) => ({
      file,
      module: require(path.join(migrationsDir, file)),
    }));
}

async function main() {
  await ensureMigrationsTable();
  const executedNames = await getExecutedMigrationNames();
  const migrations = loadMigrationModules();

  for (const { file, module } of migrations) {
    const name = module.name || file;
    if (executedNames.has(name)) {
      console.log(`[migrate] skip ${name}`);
      continue;
    }

    if (typeof module.up !== 'function') {
      throw new Error(`Migration ${file} is missing an up() function`);
    }

    console.log(`[migrate] running ${name}`);
    await db.withTransaction(async (tx) => {
      await module.up(tx);
      await tx.query('INSERT INTO app_migrations (name) VALUES (?)', [name]);
    });
    console.log(`[migrate] done ${name}`);
  }

  console.log('[migrate] all migrations complete');
  await db.pool.end();
}

main().catch(async (error) => {
  console.error('[migrate] failed', error);
  try {
    await db.pool.end();
  } catch {
    // Ignore pool shutdown errors.
  }
  process.exit(1);
});
