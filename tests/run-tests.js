const assert = require('node:assert/strict');
const http = require('node:http');
const db = require('../connection/mySqlConnection');

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  const { validateConfig } = require('../config/env');
  const { buildInClause } = require('../utils/sql');
  const quoteService = require('../services/quoteService');
  const customerService = require('../services/customerService');
  const app = require('../app');

  await run('validateConfig reports missing secrets in non-strict mode', async () => {
    const oldJwt = process.env.JWT_SECRET;
    const oldRefresh = process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    const result = validateConfig({ logger: { warn() {} }, strict: false });
    assert.deepEqual(result.missing.sort(), ['JWT_REFRESH_SECRET', 'JWT_SECRET']);

    process.env.JWT_SECRET = oldJwt;
    process.env.JWT_REFRESH_SECRET = oldRefresh;
  });

  await run('buildInClause expands positional placeholders', async () => {
    const result = buildInClause([1, 2, 3]);
    assert.equal(result.clause, '(?,?,?)');
    assert.deepEqual(result.params, [1, 2, 3]);
  });

  await run('buildInClause returns NULL clause for empty list', async () => {
    const result = buildInClause([]);
    assert.equal(result.clause, '(NULL)');
    assert.deepEqual(result.params, []);
  });

  await run('normalizeQuotePayload applies platform pricing automatically', async () => {
    const payload = quoteService._internals.normalizeQuotePayload({
      quoteDate: '2025-02-04',
      customerOrderNo: 'WI114020401a',
      customerName: '易亨',
      gameTitle: '我獨自成仙',
      quantity: 2,
      platforms: { ios: true, android: true, web: false, other: false },
      signedAt: '2025-02-05',
    });

    assert.equal(payload.unitPriceUntaxed, 40000);
    assert.equal(payload.totalUntaxed, 80000);
    assert.equal(payload.caseStatus, 'SIGNED');
    assert.equal(payload.billingStatus, 'UNBILLED');
    assert.equal(payload.platforms.ios, true);
    assert.ok(payload.dedupeKey.includes('WI114020401A'));
  });

  await run('normalizeQuotePayload requires other amount when other platform is selected', async () => {
    assert.throws(
      () => quoteService._internals.normalizeQuotePayload({
        quoteDate: '2025-02-04',
        customerName: '易亨',
        gameTitle: '我獨自成仙',
        quantity: 1,
        platforms: { other: true },
      }),
      /otherPriceUntaxed/
    );
  });

  await run('customer payload normalization accepts either name or id', async () => {
    const payload = customerService._internals.normalizeCustomerPayload({
      name: '鑒真數位',
      contactEmail: 'hello@example.com',
    });

    assert.equal(payload.name, '鑒真數位');
    assert.equal(payload.contactEmail, 'hello@example.com');
  });

  await run('assertCaseTransition blocks backward transitions', async () => {
    assert.throws(
      () => quoteService._internals.assertCaseTransition('IN_PROGRESS', 'QUOTED'),
      /cannot move backwards/
    );
  });

  await run('app bootstraps as an express instance', async () => {
    assert.equal(typeof app.use, 'function');
  });

  await run('homepage renders login page and legacy storefront routes redirect', async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const loginRes = await fetch(`http://127.0.0.1:${port}/`);
      const loginHtml = await loginRes.text();
      assert.equal(loginRes.status, 200);
      assert.equal(loginHtml.includes('Game QA Hub'), true);

      const indexRes = await fetch(`http://127.0.0.1:${port}/index`, { redirect: 'manual' });
      assert.equal(indexRes.status, 302);
      assert.equal(indexRes.headers.get('location'), '/dashboard');

      const cartRes = await fetch(`http://127.0.0.1:${port}/shopcart`, { redirect: 'manual' });
      assert.equal(cartRes.status, 302);
      assert.equal(cartRes.headers.get('location'), '/quotes');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  if (!process.exitCode) {
    console.log('All tests passed');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch {
      // Ignore pool shutdown errors in tests.
    }
  });
