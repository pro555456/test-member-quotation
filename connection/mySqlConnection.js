// connection/mySqlConnection.js
const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
<<<<<<< HEAD
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'shop',

  // 企業級建議設定
=======
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "game_qa_platform",
>>>>>>> 4e5e5da (game_quotation_first)
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,

  connectTimeout: 10000,
  timezone: '+08:00',
  dateStrings: true,     // DATETIME 不轉 JS Date（避免時區雷）
  supportBigNumbers: true,
  bigNumberStrings: true
};

// 建立 pool
const pool = mysql.createPool(config);

// 啟動時測試連線
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[MySQL] 連線正常', `${config.host}:${config.port}/${config.database}`);
  } catch (err) {
    console.error('[MySQL] 連線失敗', err.message);
    process.exit(1); // DB 掛了直接不啟動（企業版做法）
  }
})();

/**
 * 一般查詢（回 rows）
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Transaction helper
 * 使用方式：
 * await withTransaction(async (tx) => {
 *   await tx.query(...)
 * })
 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tx = {
      query: async (sql, params = []) => {
        const [rows] = await conn.execute(sql, params);
        return rows;
      }
    };

    const result = await fn(tx);

    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction
};

<<<<<<< HEAD

// const mysql = require('mysql');

// const config = {
//   host: process.env.DB_HOST || 'host.docker.internal' || '127.0.0.1', 
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASS || '',
//   database: process.env.DB_NAME || 'shop',
//   port: Number(process.env.DB_PORT || 3306),
//   connectTimeout: 10000,
//   acquireTimeout: 10000
// };

// const pool = mysql.createPool(config);

// pool.getConnection((err, conn) => {
//   if (err) {
//     console.error('[MySQL] 取連線失敗：', err.code, err.message, 'host=', config.host, 'port=', config.port);
//   } else {
//     conn.ping(pingErr => {
//       if (pingErr) console.error('[MySQL] ping 失敗：', pingErr);
//       else console.log('[MySQL] 連線正常');
//       conn.release();
//     });
//   }
// });

// function query(sql, params) {
//   return new Promise((resolve, reject) => {
//     pool.query(sql, params, (err, rows) => {
//       if (err) return reject(err);
//       resolve(rows);
//     });
//   });
// }

// // connection/mySqlConnection.js (加在 module.exports 之前)

// async function withTransaction(fn) {
//   const conn = await pool.getConnection();
//   try {
//     await conn.beginTransaction();

//     // 提供 tx.query 介面給外面用
//     const tx = {
//       query: (sql, params) => conn.query(sql, params),
//     };

//     const result = await fn(tx);

//     await conn.commit();
//     return result;
//   } catch (err) {
//     try { await conn.rollback(); } catch {}
//     throw err;
//   } finally {
//     conn.release();
//   }
// }

// module.exports = {
//   pool,
//   query,          // 你原本的
//   withTransaction // ✅ 新增
// };


// // module.exports = { pool, query };
=======
>>>>>>> 4e5e5da (game_quotation_first)
