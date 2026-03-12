const path = require('node:path');
const db = require('../connection/mySqlConnection');

function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

async function main() {
  const projectRoot = path.join(__dirname, '..');
  process.chdir(projectRoot);

  const { validateConfig } = requireFresh('../config/env');
  const result = validateConfig({ logger: console, strict: false });
  if (result.missing.length) {
    console.warn(`[smoke] config missing: ${result.missing.join(', ')}`);
  }

  const app = requireFresh('../app');
  if (!app || typeof app.use !== 'function') {
    throw new Error('Express app failed to bootstrap');
  }

  console.log('Smoke check passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch {
      // Ignore pool shutdown errors during smoke checks.
    }
  });
