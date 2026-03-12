const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'game_qa_platform',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  connectTimeout: 10000,
  timezone: '+08:00',
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
};

const pool = mysql.createPool(config);

(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[MySQL] connected', `${config.host}:${config.port}/${config.database}`);
  } catch (error) {
    if (error?.message === 'Pool is closed.') {
      return;
    }
    console.error('[MySQL] connection failed', error.message);
    process.exit(1);
  }
})();

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function withTransaction(fn) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const tx = {
      query: async (sql, params = []) => {
        const [rows] = await conn.execute(sql, params);
        return rows;
      },
    };

    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback failures and surface the original error.
    }

    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
};

