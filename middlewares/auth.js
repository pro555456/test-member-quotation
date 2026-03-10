// 下面直接給你一份「最終企業版、乾淨可維護」的 middlewares/auth.js（整檔覆蓋即可）：
// ✅ requireAuth()：預設不查 DB（效能好）
// ✅ requireAuth({ checkDisabled: true })：強制秒踢（任何路由都可用）
// ✅ requireAuthSensitive：用白名單陣列集中管理「哪些 API 要秒踢」（/api/admin、/submitOrder、/history…）
// ✅ Page 版：requireAuthPage() + requireAuthPageSensitive() 同樣支援秒踢
// ✅ 路徑判斷：同時支援 req.path（已掛 /api 時）與 req.originalUrl
// ✅ middlewares/auth.js（最終企業版）
// middlewares/auth.js
const jwt = require('jsonwebtoken');
const mySqlDb = require('../connection/mySqlConnection');

/* =========================
 * Cookie helpers
 * ========================= */
function cookieCommon() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
  };
}

function clearAuthCookies(res) {
  const common = cookieCommon();
  res.clearCookie('access_token', common);
  res.clearCookie('refresh_token', { ...common, path: '/api/refresh' });
}

/* =========================
 * Token helpers
 * ========================= */
function getAccessToken(req) {
  return req.cookies?.access_token || null;
}

function verifyAccessToken(req) {
  const token = getAccessToken(req);
  if (!token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
}
// 如果 mySqlDb.query() 是 mysql2/promise，會回 [rows, fields]，那 rows[0] 會變成「整個 rows array」，你就會拿不到 is_disabled。
// 建議改成（整段替換 isUserDisabled）：
async function isUserDisabled(userId) {
  const r = await mySqlDb.query(
    'SELECT is_disabled FROM custaccount WHERE id=? LIMIT 1',
    [userId]
  );

  const rows = Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r; // ✅ 兼容
  if (!rows || rows.length === 0) return true;

  const v = rows[0].is_disabled;
  return v === 1 || v === true;
}


// /* =========================
//  * Disabled check (DB)
//  * ========================= */
// async function isUserDisabled(userId) {
//   const rows = await mySqlDb.query(
//     'SELECT is_disabled FROM custaccount WHERE id=? LIMIT 1',
//     [userId]
//   );
//   if (!rows || rows.length === 0) return true; // 安全：查不到視為停用
//   return rows[0].is_disabled === 1 || rows[0].is_disabled === true;
// }

/* =========================
 * Path matching (clean & safe)
 * =========================
 * 你的 app.js 多半是 app.use('/api', apiRouter)
 * 所以：
 * - req.path:   '/submitOrder'（不含 /api）
 * - originalUrl:'/api/submitOrder'（含 /api）
 * 我們兩個都比，避免踩雷
 */
function getReqPaths(req) {
  const path = req.path || '';
  const url = req.originalUrl || '';
  return { path, url };
}

/**
 * 白名單設定：哪些 API / Page 要秒踢（DB check）
 *
 * 你只要改這個陣列就好（可維護）
 *
 * 規則：
 * - 以 "/api/..." 開頭：會用 originalUrl 來比對
 * - 以 "/..." 開頭但非 "/api"：會用 req.path 來比對（適合掛在 app.use('/api') 下）
 */
const SENSITIVE_API_PREFIXES = [
  '/api/admin',        // 後台 API（建議全秒踢）
  '/api/submitOrder',  // 下單
  '/api/history',      // 訂單歷史
  // 想秒踢更多就加：
  // '/api/profile',
  // '/api/payment',
];

const SENSITIVE_API_PATHS = [
  '/submitOrder', // 掛 /api 後 req.path 會長這樣
  '/history',
];

const SENSITIVE_PAGE_PREFIXES = [
  '/admin', // 後台頁面一律秒踢
];

function matchByPrefixes(value, prefixes = []) {
  for (const p of prefixes) {
    if (value.startsWith(p)) return true;
  }
  return false;
}

function shouldCheckDisabledApi(req) {
  const { path, url } = getReqPaths(req);
  // originalUrl: /api/xxx
  if (matchByPrefixes(url, SENSITIVE_API_PREFIXES)) return true;
  // req.path: /xxx
  if (matchByPrefixes(path, SENSITIVE_API_PATHS)) return true;
  return false;
}

function shouldCheckDisabledPage(req) {
  const p = req.path || req.originalUrl || '';
  return matchByPrefixes(p, SENSITIVE_PAGE_PREFIXES);
}

/* =========================
 * requireAuth factory (clean)
 * =========================
 * 用法：
 * - requireAuth()                       -> 不查 DB（快）
 * - requireAuth({ checkDisabled:true }) -> 查 DB 秒踢（敏感路由用）
 */
function requireAuth(options = {}) {
  const { checkDisabled = false, clearCookiesOnFail = true } = options;

  return async (req, res, next) => {
    try {
      const payload = verifyAccessToken(req);
      if (!payload) return res.status(401).json({ message: 'Not logged in' });

      if (checkDisabled) {
        const disabled = await isUserDisabled(payload.id);
        if (disabled) {
          if (clearCookiesOnFail) clearAuthCookies(res);
          return res.status(401).json({ message: 'Account disabled' });
        }
      }

      req.user = payload; // { id, account, type, name, ... }
      return next();
    } catch (err) {
      if (clearCookiesOnFail) clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

/**
 * ✅ 一個「企業版」總入口：敏感 API 統一用它
 * - 你不需要在每條路由手動寫 checkDisabled:true
 */
const requireAuthSensitive = async (req, res, next) => {
  const fn = requireAuth({ checkDisabled: true });
  return fn(req, res, next);
};

/**
 * ✅ 你也可以做「自動判斷」版本：
 * - 同一個 middleware 用在所有 API：會依白名單決定是否查 DB
 * - 想全站秒踢：把 shouldCheckDisabledApi 改成永遠 true 即可
 */
const requireAuthAuto = async (req, res, next) => {
  const needCheck = shouldCheckDisabledApi(req);
  const fn = requireAuth({ checkDisabled: needCheck });
  return fn(req, res, next);
};

/* =========================
 * Admin (保留給簡單場景)
 * 你已用 RBAC(requirePermission) 就不一定需要它
 * ========================= */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Not logged in' });
  if (req.user.type !== 'A') return res.status(403).json({ message: 'Admin only' });
  return next();
}

/* =========================
 * Page middlewares
 * ========================= */
function requireAuthPage(options = {}) {
  const { checkDisabled = false, clearCookiesOnFail = true } = options;

  return async (req, res, next) => {
    try {
      const payload = verifyAccessToken(req);
      if (!payload) return res.redirect('/login');

      if (checkDisabled) {
        const disabled = await isUserDisabled(payload.id);
        if (disabled) {
          if (clearCookiesOnFail) clearAuthCookies(res);
          return res.redirect('/login');
        }
      }

      req.user = payload;
      return next();
    } catch (err) {
      if (clearCookiesOnFail) clearAuthCookies(res);
      return res.redirect('/login');
    }
  };
}

const requireAuthPageSensitive = async (req, res, next) => {
  const fn = requireAuthPage({ checkDisabled: true });
  return fn(req, res, next);
};

const requireAuthPageAuto = async (req, res, next) => {
  const needCheck = shouldCheckDisabledPage(req);
  const fn = requireAuthPage({ checkDisabled: needCheck });
  return fn(req, res, next);
};

function requireAdminPage(req, res, next) {
  if (!req.user || req.user.type !== 'A') return res.redirect('/login');
  return next();
}

module.exports = {
  // factories
  requireAuth,
  requireAuthPage,

  // ready-to-use
  requireAuthSensitive,
  requireAuthAuto,
  requireAuthPageSensitive,
  requireAuthPageAuto,

  // optional legacy
  requireAdmin,
  requireAdminPage,

  // config helpers (debug / future use)
  shouldCheckDisabledApi,
  shouldCheckDisabledPage,
  SENSITIVE_API_PREFIXES,
  SENSITIVE_API_PATHS,
  SENSITIVE_PAGE_PREFIXES,
};

