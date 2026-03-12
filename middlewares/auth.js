const jwt = require('jsonwebtoken');
const mySqlDb = require('../connection/mySqlConnection');

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

function getAccessToken(req) {
  return req.cookies?.access_token || null;
}

function verifyAccessToken(req) {
  const token = getAccessToken(req);
  if (!token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function isUserDisabled(userId) {
  const rows = await mySqlDb.query(
    'SELECT is_disabled FROM custaccount WHERE id=? LIMIT 1',
    [userId]
  );

  if (!rows || !rows.length) return true;
  const value = rows[0].is_disabled;
  return value === 1 || value === true;
}

function getReqPaths(req) {
  return {
    path: req.path || '',
    url: req.originalUrl || '',
  };
}

const SENSITIVE_API_PREFIXES = [
  '/api/admin',
  '/api/submitOrder',
  '/api/history',
  '/api/dashboard',
  '/api/quotes',
  '/api/cases',
  '/api/import',
  '/api/products',
  '/api/payment',
];

const SENSITIVE_API_PATHS = [
  '/submitOrder',
  '/history',
  '/dashboard',
  '/quotes',
  '/cases',
  '/import',
  '/products',
  '/payment',
];

const SENSITIVE_PAGE_PREFIXES = [
  '/admin',
  '/dashboard',
  '/quotes',
  '/cases',
];

function matchByPrefixes(value, prefixes = []) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function shouldCheckDisabledApi(req) {
  const { path, url } = getReqPaths(req);
  return matchByPrefixes(url, SENSITIVE_API_PREFIXES) || matchByPrefixes(path, SENSITIVE_API_PATHS);
}

function shouldCheckDisabledPage(req) {
  const pathname = req.path || req.originalUrl || '';
  return matchByPrefixes(pathname, SENSITIVE_PAGE_PREFIXES);
}

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

      req.user = payload;
      return next();
    } catch (error) {
      if (clearCookiesOnFail) clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

const requireAuthSensitive = async (req, res, next) => requireAuth({ checkDisabled: true })(req, res, next);
const requireAuthAuto = async (req, res, next) => requireAuth({ checkDisabled: shouldCheckDisabledApi(req) })(req, res, next);

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Not logged in' });
  if (req.user.type !== 'A') return res.status(403).json({ message: 'Admin only' });
  return next();
}

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
    } catch (error) {
      if (clearCookiesOnFail) clearAuthCookies(res);
      return res.redirect('/login');
    }
  };
}

const requireAuthPageSensitive = async (req, res, next) => requireAuthPage({ checkDisabled: true })(req, res, next);
const requireAuthPageAuto = async (req, res, next) => requireAuthPage({ checkDisabled: shouldCheckDisabledPage(req) })(req, res, next);

function requireAdminPage(req, res, next) {
  if (!req.user || req.user.type !== 'A') return res.redirect('/login');
  return next();
}

module.exports = {
  requireAuth,
  requireAuthPage,
  requireAuthSensitive,
  requireAuthAuto,
  requireAuthPageSensitive,
  requireAuthPageAuto,
  requireAdmin,
  requireAdminPage,
  shouldCheckDisabledApi,
  shouldCheckDisabledPage,
  SENSITIVE_API_PREFIXES,
  SENSITIVE_API_PATHS,
  SENSITIVE_PAGE_PREFIXES,
  clearAuthCookies,
};
