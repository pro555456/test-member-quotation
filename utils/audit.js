// 你這份 audit.js + admin_audit_log DDL 整體很OK ✅（欄位設計也對）。目前唯一需要調整的是：
// audit.js 裡少了 mySqlDb 的 require（不然會直接 ReferenceError）
// 要做到「企業級一致性」：在 withTransaction(tx => ...) 裡要用 writeAuditLogTx(tx, req, ...)，不要用外面的 mySqlDb.query
// 你在 Nginx 上線後要記得 trust proxy，不然 req.ip / x-forwarded-for 會不準
// 下面我給你一份「乾淨企業版」utils/audit.js（整檔覆蓋），再示範你 API 要怎麼接。
// ✅ 最終版：utils/audit.js（整檔覆蓋）
// utils/audit.js
const mySqlDb = require('../connection/mySqlConnection');

/**
 * 取得 client IP
 * - 若有 Nginx/Proxy：優先抓 x-forwarded-for 第一個
 * - 否則抓 req.ip
 */
function getClientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').toString();
  const ip = (xf.split(',')[0] || req.ip || '').trim();
  return ip.slice(0, 45);
}

function getUserAgent(req) {
  return (req.headers['user-agent'] || '').toString().slice(0, 255);
}

function safeJson(detail) {
  if (detail == null) return null;
  try {
    return JSON.stringify(detail);
  } catch {
    return JSON.stringify({ note: 'detail_not_serializable' });
  }
}

// 1) 你的 utils/audit.js 要不要優化？
// 結論：延用即可。
// 你已經同時提供：
// writeAuditLog(req, ..., tx?)（可交易/可非交易）
// writeAuditLogTx(tx, req, ...)（交易一致性）
// 而且你已處理 IP/UA 截斷、JSON stringify 保護，這很夠用了。
// 我唯一建議修正的小點
// 你 writeAuditLog() 內 ip/ua 沒做 slice（只在 getClientIp/getUserAgent 有做），建議一致化，避免 DB 欄位長度爆掉：
async function writeAuditLog(req, { action, targetUserId = null, detail = {} }, tx = null) {
  const actorUserId = req.user?.id || null;
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  const runner = tx || mySqlDb;
  await runner.query(
    `INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, ip, user_agent, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [actorUserId, String(action || '').slice(0, 100), targetUserId, ip, ua, safeJson(detail)]
  );
}

// // ✅ 寫 audit log（需要 admin_audit_log 表）
// async function writeAuditLog(req, { action, targetUserId = null, detail = {} }, tx = null) {
//   const actorUserId = req.user?.id || null;
//   const ip =
//     (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null) ||
//     req.ip ||
//     null;
//   const ua = req.headers['user-agent'] || null;

//   const runner = tx || mySqlDb;
//   await runner.query(
//     `INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, ip, user_agent, detail_json, created_at)
//      VALUES (?, ?, ?, ?, ?, ?, NOW())`,
//     [actorUserId, action, targetUserId, ip, ua, JSON.stringify(detail || {})]
//   );
// }

/**
 * ✅ 交易版：寫在同一個 tx 裡，確保一致性（企業版推薦）
 * 注意：若你希望「主交易失敗也要留 log」，就不要用 tx 版（或改成獨立寫一筆 ERROR log）
 */
async function writeAuditLogTx(tx, req, { action, targetUserId = null, detail = null }) {
  const actorId = req.user?.id;
  if (!actorId) return;

  await tx.query(
    `INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, ip, user_agent, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [actorId, action, targetUserId, getClientIp(req), getUserAgent(req), safeJson(detail)]
  );
}

module.exports = { getClientIp, writeAuditLog, writeAuditLogTx };



