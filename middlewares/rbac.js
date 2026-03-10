// ✅ 問題點 1：你新增人員時永遠把 type 寫死成 'U'
// ✅ 問題點 2：你 RBAC 的 loadPermissionsFromDb() 沒處理 mysql2 的回傳格式
// ✅ 最終修正（照貼就會好）
// A) middlewares/rbac.js：把 DB 查詢那段改成兼容版（整檔覆蓋你現有檔案）
// middlewares/rbac.js
const mySqlDb = require('../connection/mySqlConnection');

const PERM_CACHE_TTL_MS = Number(process.env.PERM_CACHE_TTL_MS || 30_000);
const permCache = new Map(); // userId -> { perms:Set<string>, exp:number }

async function dbRows(sql, params = []) {
  const r = await mySqlDb.query(sql, params);
  // mysql2/promise: [rows, fields]
  if (Array.isArray(r) && Array.isArray(r[0])) return r[0];
  return r; // 你的封裝若已直接回 rows
}

async function loadPermissionsFromDb(userId) {
  const rows = await dbRows(
    `SELECT DISTINCT p.code AS perm
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ?`,
    [userId]
  );
  return new Set((rows || []).map(r => r.perm).filter(Boolean));
}

async function loadPermissions(userId) {
  const now = Date.now();
  const cached = permCache.get(userId);
  if (cached && cached.exp > now) return cached.perms;

  const perms = await loadPermissionsFromDb(userId);
  permCache.set(userId, { perms, exp: now + PERM_CACHE_TTL_MS });
  return perms;
}

function invalidateUserPermCache(userId) {
  permCache.delete(userId);
}

async function ensureReqUserPerms(req) {
  const userId = req.user?.id;
  if (!userId) return null;

  if (req.user.perms instanceof Set) return req.user.perms;

  const perms = await loadPermissions(userId);
  req.user.perms = perms;
  return perms;
}

function requirePermission(perm) {
  return async (req, res, next) => {
    try {
      const perms = await ensureReqUserPerms(req);
      if (!perms) return res.status(401).json({ message: 'Not logged in' });

      if (!perms.has(perm)) {
        return res.status(403).json({ message: 'Forbidden', need: perm });
      }
      return next();
    } catch (e) {
      console.error('RBAC error:', e);
      return res.status(500).json({ message: 'RBAC error' });
    }
  };
}

function requirePermissionPage(perm, options = {}) {
  const { onForbiddenRedirect = '/login', onErrorRedirect = '/login' } = options;

  return async (req, res, next) => {
    try {
      const perms = await ensureReqUserPerms(req);
      if (!perms) return res.redirect('/login');

      if (!perms.has(perm)) {
        return res.redirect(onForbiddenRedirect);
      }
      return next();
    } catch (e) {
      console.error('RBAC(PAGE) error:', e);
      return res.redirect(onErrorRedirect);
    }
  };
}

module.exports = {
  requirePermission,
  requirePermissionPage,
  invalidateUserPermCache,
};



// // 你這份 rbac.js（API 版）已經 OK；現在要做 Page 版 requirePermissionPage('user:manage')，核心差別只有兩點：
// // 回應方式不同：API 用 res.status(403).json()；Page 要用 res.redirect('/login') 或 res.status(403).render(...)
// // perms 快取位置：你現在放 req.user.perms（Set）可以沿用，Page/Api 都能共用
// // 下面我直接給你「整合後的企業版 rbac.js」：同一檔同時支援
// // requirePermission('xxx')（API）
// // requirePermissionPage('xxx')（Page）
// // （可選）小型記憶體快取：同一個 user 在短時間內不必每次查 DB（很常見的企業作法）
// // ✅ middlewares/rbac.js（整檔覆蓋）
// // middlewares/rbac.js
// const mySqlDb = require('../connection/mySqlConnection');

// /**
//  * 可選：記憶體快取（簡單企業版）
//  * - 省 DB：同一 user 30 秒內不重查 perms
//  * - 你的專案是單機/單容器 OK；多台要用 Redis 才準
//  */
// const PERM_CACHE_TTL_MS = Number(process.env.PERM_CACHE_TTL_MS || 30_000);
// const permCache = new Map(); // userId -> { perms:Set<string>, exp:number }

// async function loadPermissionsFromDb(userId) {
//   const rows = await mySqlDb.query(
//     `SELECT DISTINCT p.code AS perm
//      FROM user_roles ur
//      JOIN role_permissions rp ON rp.role_id = ur.role_id
//      JOIN permissions p ON p.id = rp.permission_id
//      WHERE ur.user_id = ?`,
//     [userId]
//   );
//   return new Set(rows.map(r => r.perm));
// }

// async function loadPermissions(userId) {
//   const now = Date.now();
//   const cached = permCache.get(userId);
//   if (cached && cached.exp > now) return cached.perms;

//   const perms = await loadPermissionsFromDb(userId);
//   permCache.set(userId, { perms, exp: now + PERM_CACHE_TTL_MS });
//   return perms;
// }

// // 你在「新增/移除角色」「變更權限」後可以呼叫這個清快取（企業常用）
// function invalidateUserPermCache(userId) {
//   permCache.delete(userId);
// }

// /**
//  * 內部：確保 req.user.perms 有值
//  * - 你已在 auth middleware 把 req.user 放好（JWT payload）
//  * - 這裡把 perms 補上去
//  */
// async function ensureReqUserPerms(req) {
//   const userId = req.user?.id;
//   if (!userId) return null;

//   // 若同一 request 內已載入，就不重查（你原本的做法）
//   if (req.user.perms instanceof Set) return req.user.perms;

//   const perms = await loadPermissions(userId);
//   req.user.perms = perms;
//   return perms;
// }

// /**
//  * API 版：沒權限 -> 403 JSON
//  */
// function requirePermission(perm) {
//   return async (req, res, next) => {
//     try {
//       const perms = await ensureReqUserPerms(req);
//       if (!perms) return res.status(401).json({ message: 'Not logged in' });

//       if (!perms.has(perm)) {
//         return res.status(403).json({ message: 'Forbidden' });
//       }
//       return next();
//     } catch (e) {
//       console.error('RBAC error:', e);
//       return res.status(500).json({ message: 'RBAC error' });
//     }
//   };
// }

// /**
//  * Page 版：沒登入/沒權限 -> redirect
//  * - 你通常會先掛 requireAuthPageAuto / requireAuthPageSensitive
//  * - 但這裡還是做保護：沒有 req.user 就回 /login
//  */
// function requirePermissionPage(perm, options = {}) {
//   const {
//     onForbiddenRedirect = '/login', // 也可改 '/403'
//     onErrorRedirect = '/login',
//   } = options;

//   return async (req, res, next) => {
//     try {
//       const perms = await ensureReqUserPerms(req);
//       if (!perms) return res.redirect('/login');

//       if (!perms.has(perm)) {
//         return res.redirect(onForbiddenRedirect);
//       }
//       return next();
//     } catch (e) {
//       console.error('RBAC(PAGE) error:', e);
//       return res.redirect(onErrorRedirect);
//     }
//   };
// }

// module.exports = {
//   requirePermission,
//   requirePermissionPage,
//   invalidateUserPermCache,
// };

