// 你問的重點：這些程式「要加在哪裡」？
// 就加在 apis/api.js 的 admin users 區塊
// 通常你的檔案會像這樣分段：
// Auth（login/register/refresh/logout/me）
// Products
// Orders/submitOrder
// Admin Users ✅（這裡放 users list / create / reset / disable / roles / logs）
// 你貼的兩段就是放在第 4 段。

const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer(); // memoryStorage → req.file.buffer 會有
const fs = require('fs');

const mySqlDb = require('../connection/mySqlConnection');

// const { MongoClient } = require('mongodb');
const { getMongoDb } = require('../connection/mongoClient');

// const mongoUrl = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/products';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const { requireAuth } = require('../middlewares/auth');
// const { requireAuth, requireAdmin } = require('../middlewares/auth');

const { requirePermission } = require('../middlewares/rbac');

const { requireAuthAuto } = require('../middlewares/auth');

const { invalidateUserPermCache } = require('../middlewares/rbac');

const { writeAuditLog, writeAuditLogTx } = require('../utils/audit');

const { normalizeAccount, normalizeEmail, isValidAccount, isValidEmail, passwordPolicyCheck, SECURITY_CONFIG } = require('../utils/security');

const { loginLimiter } = require('../middlewares/rateLimit');

const { getPasswordPolicyText } = require('../utils/security');
const { getPublicSecurityConfig } = require('../utils/security');

const { sendMail } = require('../utils/mailer');


router.get('/security/config', (req, res) => {
  return res.json({
    passwordPolicyText: getPasswordPolicyText()
  });
});
// router.get('/security/config', requireAuthAuto, (req, res) => {
//   return res.json({
//     passwordPolicyText: getPasswordPolicyText()
//   });
// });

router.get('/security/config', (req, res) => {
  return res.json(getPublicSecurityConfig());
});
// router.get('/security/config', requireAuthAuto, (req, res) => {
//   return res.json(getPublicSecurityConfig());
// });


// 綠界（建議這樣引入，不要寫 ../node_modules/...）
const ecpay_payment = require('ecpay_aio_nodejs/lib/ecpay_payment');
const options = require('ecpay_aio_nodejs/conf/config-example');

/* =========================
 * 共用工具
 * ========================= */
function parseTtlToMs(ttl, fallbackMs = 15 * 60 * 1000) {
  const m = /^(\d+)([smhd])$/.exec(String(ttl || ''));
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * mult;
}

function cookieCommon() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
  };
}

function newJti() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env: ${name}`);
}

function safeJson(res, status, body) {
  return res.status(status).json(body);
}

function getOrSetDeviceId(req, res) {
  let deviceId = req.cookies?.device_id;
  if (!deviceId) {
    deviceId = newJti(); // UUID
    res.cookie('device_id', deviceId, {
      ...cookieCommon(),
      maxAge: 180 * 24 * 60 * 60 * 1000, // 180天
      path: '/',
    });
  }
  return deviceId;
}

// ====== helpers ======
// 2) 先確認你已有這些 helper / import
// 放在 apis/api.js 頂部附近，若已有就不用重複加：
function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

function clampStr(v, max = 255) {
  const s = String(v ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim().slice(0, 64);
}

function getBaseUrl(req) {
  // 建議用 APP_BASE_URL（正式環境固定網址）
  const base = process.env.APP_BASE_URL;
  if (base) return base.replace(/\/$/, '');
  // fallback：用 request host（開發可用）
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  return `${proto}://${host}`.replace(/\/$/, '');
}

// 3) 忘記密碼 rate limit（記憶體版）
// 放在 apis/api.js 內、routes 上方即可：
const _forgotPwdHits = new Map();
/**
 * key: `${ip}|${identifier}`
 * value: { count, resetAt }
 */
function forgotPasswordRateLimit(req, identifier) {
  const windowMs = Number(process.env.FORGOT_PASSWORD_WINDOW_MS || 15 * 60 * 1000); // 15 min
  const max = Number(process.env.FORGOT_PASSWORD_MAX || 5);

  const ip = getClientIp(req) || 'unknown';
  const key = `${ip}|${String(identifier || '').toLowerCase()}`;

  const now = Date.now();
  const cur = _forgotPwdHits.get(key);

  if (!cur || now > cur.resetAt) {
    _forgotPwdHits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (cur.count >= max) {
    const retryAfterSec = Math.ceil((cur.resetAt - now) / 1000);
    return { ok: false, retryAfterSec };
  }

  cur.count += 1;
  _forgotPwdHits.set(key, cur);
  return { ok: true };
}

/* =========================
 * 基本 API：商品
 * ========================= */


// 取得所有商品（MySQL + MongoDB 圖片合併）
router.get('/products', async (req, res) => {
  try {
    const products = await mySqlDb.query('SELECT * FROM product');

    const db = await getMongoDb('products');
    const imageList = await db.collection('image').find().toArray();

    const imgMap = new Map(imageList.map(x => [x.id, x.image]));
    for (const p of products) {
      const img = imgMap.get(p.id);
      if (img) p.img = img;
    }

    return res.status(200).json({ productList: products });
  } catch (err) {
    console.error('取得商品資料時發生錯誤:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to load products' });
  }
});


/* =========================
 * Auth：註冊 / 登入 / me / refresh / logout
 * ========================= */
// 2) ✅ 可覆蓋版後端 /api/register（把你舊的整段換掉）
// 你舊版 register 是直接 insert。下面這版會：
// 使用 normalizeAccount / normalizeEmail / isValidAccount / isValidEmail / passwordPolicyCheck / SECURITY_CONFIG
// email/cellphone 必填
// 建立 user（type=U）
// 指派 customer role（若 roles 表有 code=customer）
// 建立註冊驗證 token 寫入 user_email_verify_tokens
// 交易成功後寄信（寄信失敗回 202 pending 並提示可重寄）
// 回 202 pending
// ===== 註冊：安全版 + Email 驗證 =====
router.post('/register', async (req, res) => {
  try {
    const body = req.body || {};

    const account = normalizeAccount(body.account);
    const email = normalizeEmail(body.email);
    const name = clampStr(body.name, 50);
    const cellphone = clampStr(body.cellphone || body.phone, 15);
    const birthday = body.birthday ? String(body.birthday).trim() : null;
    const password = String(body.password || '');

    // ✅ 必填
    if (!account || !password) return safeJson(res, 400, { status: 'error', message: 'account/password required' });
    if (!cellphone) return safeJson(res, 400, { status: 'error', message: '手機為必填' });
    if (!email) return safeJson(res, 400, { status: 'error', message: 'Email 為必填' });

    // ✅ 格式檢查（與後台一致）
    if (!isValidAccount(account)) return safeJson(res, 400, { status: 'error', message: 'account 格式不正確（例：staff01 / admin.test）' });
    if (!isValidEmail(email)) return safeJson(res, 400, { status: 'error', message: 'email 格式不正確' });

    const pwdErr = passwordPolicyCheck(password, account);
    if (pwdErr) return safeJson(res, 400, { status: 'error', message: pwdErr });

    const safePwd = password.slice(0, SECURITY_CONFIG.PWD_MAX);
    const hash = await bcrypt.hash(safePwd, 12);

    let newUserId = null;
    let token = null;
    const expiresMinutes = Number(process.env.EMAIL_VERIFY_EXPIRE_MIN || 30);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await mySqlDb.withTransaction(async (tx) => {
      // account unique
      const exA = await tx.query(`SELECT id FROM custaccount WHERE account=? LIMIT 1`, [account]);
      const exAList = (Array.isArray(exA) && Array.isArray(exA[0])) ? exA[0] : exA;
      if (exAList?.length) { const err = new Error('ACCOUNT_EXISTS'); err.code = 'ACCOUNT_EXISTS'; throw err; }

      // email unique
      const exE = await tx.query(`SELECT id FROM custaccount WHERE email=? LIMIT 1`, [email]);
      const exEList = (Array.isArray(exE) && Array.isArray(exE[0])) ? exE[0] : exE;
      if (exEList?.length) { const err = new Error('EMAIL_EXISTS'); err.code = 'EMAIL_EXISTS'; throw err; }

      // cellphone unique（如果你希望唯一）
      const exC = await tx.query(`SELECT id FROM custaccount WHERE cellphone=? LIMIT 1`, [cellphone]);
      const exCList = (Array.isArray(exC) && Array.isArray(exC[0])) ? exC[0] : exC;
      if (exCList?.length) { const err = new Error('CELLPHONE_EXISTS'); err.code = 'CELLPHONE_EXISTS'; throw err; }

      const ins = await tx.query(
        `INSERT INTO custaccount
         (account, password, type, name, cellphone, email, email_verified_at, birthday, remark, is_disabled, create_date, update_date)
         VALUES (?, ?, 'U', ?, ?, ?, NULL, ?, NULL, 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        [account, hash, name || '', cellphone || '', email, birthday || null]
      );
      newUserId = ins.insertId || ins?.[0]?.insertId;

      // 指派 customer role（若存在）
      const rRows = await tx.query(`SELECT id FROM roles WHERE LOWER(code)='customer' LIMIT 1`);
      const rRow = (Array.isArray(rRows) && Array.isArray(rRows[0])) ? rRows[0][0] : rRows[0];
      const customerRoleId = rRow?.id ? Number(rRow.id) : null;
      if (customerRoleId) {
        await tx.query(`INSERT IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)`, [newUserId, customerRoleId]);
      }

      // 建立註冊驗證 token
      token = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256Hex(token);

      await tx.query(
        `INSERT INTO user_email_verify_tokens
         (user_id, email, token_hash, expires_at, created_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newUserId,
          email,
          tokenHash,
          expiresAt,
          getClientIp(req),
          clampStr(req.headers['user-agent'], 255)
        ]
      );

      await writeAuditLogTx(tx, req, {
        action: 'USER_REGISTER',
        targetUserId: newUserId,
        detail: { account, email, cellphone }
      });
    });

    // 交易成功後寄信
    const baseUrl = getBaseUrl(req);
    // ✅ 前端驗證頁：/verify-register-email（pages route）
    const link = `${baseUrl}/verify-register-email?token=${encodeURIComponent(token)}`;

    try {
      await sendMail({
        to: email,
        subject: 'TMC SHOP - 註冊 Email 驗證',
        text: `請點擊以下連結完成註冊 Email 驗證（${expiresMinutes} 分鐘內有效）：\n${link}`,
        html: `
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
            <p>您好，</p>
            <p>歡迎註冊 TMC SHOP，請點擊以下連結完成 Email 驗證（<b>${expiresMinutes}</b> 分鐘內有效）：</p>
            <p><a href="${link}">${link}</a></p>
            <p>若非本人操作，請忽略本信。</p>
          </div>
        `
      });
    } catch (mailErr) {
      console.error('[register] send verify mail failed:', mailErr);
      // 註冊已成功，但信寄失敗：回 202 告知用戶可重寄
      return safeJson(res, 202, {
        status: 'pending',
        message: '註冊成功，但驗證信寄送失敗，請稍後再試「重新寄送驗證信」'
      });
    }

    return safeJson(res, 202, {
      status: 'pending',
      message: '註冊成功，已寄出驗證信，請至 Email 收信完成驗證'
    });

  } catch (err) {
    if (err?.code === 'ACCOUNT_EXISTS') return safeJson(res, 409, { status: 'error', message: 'Account already exists' });
    if (err?.code === 'EMAIL_EXISTS') return safeJson(res, 409, { status: 'error', message: 'Email 已被使用' });
    if (err?.code === 'CELLPHONE_EXISTS') return safeJson(res, 409, { status: 'error', message: '手機已被使用' });
    if (err?.code === 'ER_DUP_ENTRY') return safeJson(res, 409, { status: 'error', message: '資料已被使用' });

    console.error('Register error:', err);
    return safeJson(res, 500, { status: 'error', message: 'Register failed' });
  }
});

// // B) 後端：新增安全版註冊 API（可直接貼）
// // 1) POST /api/register（套用 security.js + 必填 email/cellphone + 強密碼 + 寄驗證信）

// // 這段跟你後台新增 user 的規格一致，只是 type 固定 U，角色可選擇預設 customer role。
// router.post('/register', async (req, res) => {
//   try {
//     const body = req.body || {};

//     const account = normalizeAccount(body.account);
//     const email = normalizeEmail(body.email);
//     const name = clampStr(body.name, 50);
//     const cellphone = clampStr(body.cellphone, 15);
//     const password = String(body.password || '');

//     // ✅ 必填
//     if (!account || !password) return res.status(400).json({ message: 'account/password required' });
//     if (!cellphone) return res.status(400).json({ message: '手機為必填' });
//     if (!email) return res.status(400).json({ message: 'Email 為必填' });

//     // ✅ 安全驗證
//     if (!isValidAccount(account)) return res.status(400).json({ message: 'account 格式不正確（例：staff01 / admin.test）' });
//     if (!isValidEmail(email)) return res.status(400).json({ message: 'email 格式不正確' });

//     const pwdErr = passwordPolicyCheck(password, account);
//     if (pwdErr) return res.status(400).json({ message: pwdErr });

//     // bcrypt 72 上限保護
//     const safePwd = password.slice(0, SECURITY_CONFIG.PWD_MAX);
//     const hash = await bcrypt.hash(safePwd, 12);

//     // 你可以用 env 決定註冊是否「必須驗證 email 才能登入」
//     const requireVerify = String(process.env.REGISTER_REQUIRE_EMAIL_VERIFY || 'true') === 'true';

//     let newUserId = null;

//     // 先寫入 DB + token（交易內）
//     let token = null;
//     let verifyEmail = email;
//     let expiresMinutes = Number(process.env.EMAIL_VERIFY_EXPIRE_MIN || 30);
//     let expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

//     await mySqlDb.withTransaction(async (tx) => {
//       // account unique
//       const exA = await tx.query(`SELECT id FROM custaccount WHERE account=? LIMIT 1`, [account]);
//       const exAList = (Array.isArray(exA) && Array.isArray(exA[0])) ? exA[0] : exA;
//       if (exAList?.length) {
//         const err = new Error('ACCOUNT_EXISTS'); err.code = 'ACCOUNT_EXISTS'; throw err;
//       }

//       // email unique
//       const exE = await tx.query(`SELECT id FROM custaccount WHERE email=? LIMIT 1`, [email]);
//       const exEList = (Array.isArray(exE) && Array.isArray(exE[0])) ? exE[0] : exE;
//       if (exEList?.length) {
//         const err = new Error('EMAIL_EXISTS'); err.code = 'EMAIL_EXISTS'; throw err;
//       }

//       // cellphone unique（如果你要求唯一）
//       const exC = await tx.query(`SELECT id FROM custaccount WHERE cellphone=? LIMIT 1`, [cellphone]);
//       const exCList = (Array.isArray(exC) && Array.isArray(exC[0])) ? exC[0] : exC;
//       if (exCList?.length) {
//         const err = new Error('CELLPHONE_EXISTS'); err.code = 'CELLPHONE_EXISTS'; throw err;
//       }

//       const ins = await tx.query(
//         `INSERT INTO custaccount
//          (account, password, type, name, cellphone, email, email_verified_at, birthday, remark, is_disabled, create_date, update_date)
//          VALUES (?, ?, 'U', ?, ?, ?, NULL, NULL, NULL, 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
//         [account, hash, name || '', cellphone || '', email]
//       );

//       newUserId = ins.insertId || ins?.[0]?.insertId;

//       // ✅ 指派預設 role（customer）
//       const rRows = await tx.query(`SELECT id FROM roles WHERE LOWER(code)='customer' LIMIT 1`);
//       const rRow = (Array.isArray(rRows) && Array.isArray(rRows[0])) ? rRows[0][0] : rRows[0];
//       const customerRoleId = rRow?.id ? Number(rRow.id) : null;
//       if (customerRoleId) {
//         // user_roles 建議要 UNIQUE (user_id, role_id) + INSERT IGNORE（你前面已做）
//         await tx.query(`INSERT IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)`, [newUserId, customerRoleId]);
//       }

//       // ✅ 建立註冊驗證 token
//       token = crypto.randomBytes(32).toString('hex');
//       const tokenHash = sha256Hex(token);

//       await tx.query(
//         `INSERT INTO user_email_verify_tokens
//          (user_id, email, token_hash, expires_at, created_ip, user_agent)
//          VALUES (?, ?, ?, ?, ?, ?)`,
//         [
//           newUserId,
//           verifyEmail,
//           tokenHash,
//           expiresAt,
//           getClientIp(req),
//           clampStr(req.headers['user-agent'], 255)
//         ]
//       );

//       await writeAuditLogTx(tx, req, {
//         action: 'USER_REGISTER',
//         targetUserId: newUserId,
//         detail: { account, email, cellphone, requireVerify }
//       });
//     });

//     // 交易成功後寄信（失敗不要整個變 500）
//     const baseUrl = getBaseUrl(req);
//     const link = `${baseUrl}/verify-register-email?token=${encodeURIComponent(token)}`;

//     try {
//       await sendMail({
//         to: verifyEmail,
//         subject: 'TMC SHOP - 註冊 Email 驗證',
//         text: `請點擊以下連結完成註冊 Email 驗證（${expiresMinutes} 分鐘內有效）：\n${link}`,
//         html: `
//           <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
//             <p>您好，</p>
//             <p>歡迎註冊 TMC SHOP，請點擊以下連結完成 Email 驗證（<b>${expiresMinutes}</b> 分鐘內有效）：</p>
//             <p><a href="${link}">${link}</a></p>
//             <p>若非本人操作，請忽略本信。</p>
//           </div>
//         `
//       });
//     } catch (mailErr) {
//       console.error('[register] send verify mail failed:', mailErr);
//       return res.status(202).json({
//         status: 'pending',
//         message: '註冊成功，但驗證信寄送失敗，請稍後到「重新寄送驗證信」再試'
//       });
//     }

//     return res.status(202).json({
//       status: 'pending',
//       message: '註冊成功，已寄出驗證信，請至 Email 收信完成驗證'
//     });

//   } catch (e) {
//     if (e?.code === 'ACCOUNT_EXISTS') return res.status(409).json({ message: 'account already exists' });
//     if (e?.code === 'EMAIL_EXISTS') return res.status(409).json({ message: 'Email 已被使用' });
//     if (e?.code === 'CELLPHONE_EXISTS') return res.status(409).json({ message: '手機已被使用' });
//     if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email/手機/帳號已被使用' });

//     console.error('register error:', e);
//     return res.status(500).json({ message: 'register failed' });
//   }
// });

// router.post('/register', async (req, res) => {
//   const data = req.body;

//   try {
//     // 基本欄位檢查
//     if (!data.account || !data.password) {
//       return safeJson(res, 400, { status: 'error', message: 'account/password required' });
//     }

//     // 帳號是否已存在
//     const exists = await mySqlDb.query('SELECT id FROM custaccount WHERE account = ? LIMIT 1', [data.account]);
//     if (exists && exists.length > 0) {
//       return safeJson(res, 409, { status: 'error', message: 'Account already exists' });
//     }

//     const passwordHash = await bcrypt.hash(data.password, 12);
//     const ROLE_USER = 'U';

//     const result = await mySqlDb.query(
//       'INSERT INTO custaccount (account, password, type, name, cellphone, email, birthday) VALUES (?, ?, ?, ?, ?, ?, ?);',
//       [data.account, passwordHash, ROLE_USER, data.name || '', data.phone || data.cellphone || '', data.email || '', data.birthday || null]
//     );

//     if (result && result.insertId) {
//       return safeJson(res, 200, { status: 'success', message: 'Registration complete' });
//     }
//     return safeJson(res, 400, { status: 'error', message: 'Insertion failed' });
//   } catch (err) {
//     console.error('Register error:', err);
//     return safeJson(res, 500, { status: 'error', message: 'Register failed' });
//   }
// });

// ✅ 可貼版本：GET /api/auth/verify-email
// 功能：使用註冊信內 token 完成驗證
// 行為：
// token 不存在 → 400 token not found
// 已使用 → 400 token already used
// 過期 → 400 token expired
// 成功 → 更新 custaccount.email_verified_at = NOW() + 將 token used_at=NOW()
// ===== 註冊 Email 驗證：點連結後完成驗證 =====
// URL: GET /api/auth/verify-email?token=xxxxx
router.get('/auth/verify-email', async (req, res) => {
  try {
    const token = String(req.query?.token || '');
    if (!token || token.length < 20) {
      return safeJson(res, 400, { status: 'error', message: 'invalid token' });
    }

    const tokenHash = sha256Hex(token);

    // 先找 token（不鎖定）
    const rows = await mySqlDb.query(
      `SELECT id, user_id, email, expires_at, used_at
       FROM user_email_verify_tokens
       WHERE token_hash=? LIMIT 1`,
      [tokenHash]
    );
    const rec = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
    if (!rec) return safeJson(res, 400, { status: 'error', message: 'token not found' });
    if (rec.used_at) return safeJson(res, 400, { status: 'error', message: 'token already used' });

    // 過期檢查
    const exp = new Date(rec.expires_at);
    if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
      return safeJson(res, 400, { status: 'error', message: 'token expired' });
    }

    await mySqlDb.withTransaction(async (tx) => {
      // ✅ 再次鎖定該 token row（避免 race condition）
      const chk = await tx.query(
        `SELECT id, user_id, email, expires_at, used_at
         FROM user_email_verify_tokens
         WHERE id=? FOR UPDATE`,
        [rec.id]
      );
      const c = (Array.isArray(chk) && Array.isArray(chk[0])) ? chk[0][0] : chk[0];
      if (!c) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (c.used_at) {
        const err = new Error('ALREADY_USED');
        err.code = 'ALREADY_USED';
        throw err;
      }

      // 再檢查過期（交易內）
      const exp2 = new Date(c.expires_at);
      if (Number.isFinite(exp2.getTime()) && exp2.getTime() < Date.now()) {
        const err = new Error('EXPIRED');
        err.code = 'EXPIRED';
        throw err;
      }

      // ✅ 設定 email_verified_at（若已驗證過，也可以視需求直接視為成功）
      await tx.query(
        `UPDATE custaccount
         SET email_verified_at = COALESCE(email_verified_at, NOW()),
             update_date = CURRENT_TIMESTAMP()
         WHERE id=?`,
        [c.user_id]
      );

      // ✅ token 標記 used_at
      await tx.query(
        `UPDATE user_email_verify_tokens
         SET used_at = NOW()
         WHERE id=?`,
        [c.id]
      );

      // ✅ 審計（如果你想要 actor，這裡 verify 通常未登入，因此 actor 可能是 null）
      await writeAuditLogTx(tx, req, {
        action: 'USER_VERIFY_REGISTER_EMAIL',
        targetUserId: c.user_id,
        detail: { email: c.email }
      });
    });

    return safeJson(res, 200, { status: 'success', message: 'email verified' });

  } catch (e) {
    if (e?.code === 'NOT_FOUND') return safeJson(res, 400, { status: 'error', message: 'token not found' });
    if (e?.code === 'ALREADY_USED') return safeJson(res, 400, { status: 'error', message: 'token already used' });
    if (e?.code === 'EXPIRED') return safeJson(res, 400, { status: 'error', message: 'token expired' });

    console.error('verify register email error:', e);
    return safeJson(res, 500, { status: 'error', message: 'verify failed' });
  }
});

// ✅ 可貼版本：POST /api/auth/verify-email/resend
// 用法（前端送其中一個就好）：
// { "email": "a@b.com" } 或 { "account": "user01" }
// 行為：
// ✅ user 不存在 / 已驗證 →（預設）回 200 但不透露（避免帳號探測）
// ✅ 若已有「未過期未使用 token」→ 直接重寄同一個 token（節省 DB）
// ✅ 若 token 過期 或沒有 token → 建立新 token
// ✅ 可選擇 revoke 舊 token（把舊 token 的 used_at=NOW()）
// ✅ Rate limit：以 IP + identifier 做限制（記憶體版；dev/單機 OK，上線多機建議改 DB/Redis）
// ⚠️ 記憶體版 rate limit：你 node 重啟會清空；若你多台機器要一致，改成 Redis/DB 版再說。
// ===== resend 註冊驗證信：Rate limit（記憶體版）=====
const _verifyResendHits = new Map();
/**
 * key: `${ip}|${identifier}`
 * value: { count, resetAt }
 */
function verifyResendRateLimit(req, identifier) {
  const windowMs = Number(process.env.VERIFY_RESEND_WINDOW_MS || 15 * 60 * 1000); // 15 min
  const max = Number(process.env.VERIFY_RESEND_MAX || 5);

  const ip = getClientIp(req) || 'unknown';
  const key = `${ip}|${String(identifier || '').toLowerCase()}`;

  const now = Date.now();
  const cur = _verifyResendHits.get(key);

  if (!cur || now > cur.resetAt) {
    _verifyResendHits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (cur.count >= max) {
    const retryAfterSec = Math.ceil((cur.resetAt - now) / 1000);
    return { ok: false, retryAfterSec };
  }

  cur.count += 1;
  _verifyResendHits.set(key, cur);
  return { ok: true };
}

// ===== resend 註冊驗證信 =====
// POST /api/auth/verify-email/resend
// body: { email?: string, account?: string }
router.post('/auth/verify-email/resend', async (req, res) => {
  try {
    const body = req.body || {};

    const rawEmail = body.email;
    const rawAccount = body.account;

    const email = rawEmail ? normalizeEmail(rawEmail) : '';
    const account = rawAccount ? normalizeAccount(rawAccount) : '';

    // 至少要有 email 或 account
    if (!email && !account) {
      return safeJson(res, 400, { status: 'error', message: 'email/account required' });
    }
    if (email && !isValidEmail(email)) {
      return safeJson(res, 400, { status: 'error', message: 'email 格式不正確' });
    }
    if (account && !isValidAccount(account)) {
      return safeJson(res, 400, { status: 'error', message: 'account 格式不正確' });
    }

    const identifier = email || account;

    // ✅ Rate limit
    const rl = verifyResendRateLimit(req, identifier);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
      return safeJson(res, 429, {
        status: 'error',
        message: `請稍後再試（${rl.retryAfterSec}s 後可再送）`
      });
    }

    const hideEnum = String(process.env.VERIFY_RESEND_HIDE_ENUM || 'true') === 'true';
    const revokeOld = String(process.env.VERIFY_RESEND_REVOKE_OLD || 'true') === 'true';

    // 找 user（用 email 或 account）
    const uRows = await mySqlDb.query(
      `SELECT id, account, email, email_verified_at
       FROM custaccount
       WHERE ${email ? 'email=?' : 'account=?'}
       LIMIT 1`,
      [email ? email : account]
    );
    const u = (Array.isArray(uRows) && Array.isArray(uRows[0])) ? uRows[0][0] : uRows[0];

    // 不透露是否存在（避免被探測）
    const okResponse = () =>
      safeJson(res, 200, { status: 'success', message: '若帳號存在且尚未驗證，系統將寄出驗證信' });

    if (!u) {
      return hideEnum ? okResponse() : safeJson(res, 404, { status: 'error', message: 'user not found' });
    }

    // 已驗證就不需要 resend
    if (u.email_verified_at) {
      return hideEnum ? okResponse() : safeJson(res, 200, { status: 'success', message: 'Email 已驗證，無需重寄' });
    }

    // ✅ 以 user.email 為準（避免有人用 account 查到後亂填 email）
    const targetEmail = normalizeEmail(u.email || email);
    if (!targetEmail) {
      // 理論上註冊時 email 必填；這裡只是保險
      return safeJson(res, 400, { status: 'error', message: 'user email missing' });
    }

    const expiresMinutes = Number(process.env.EMAIL_VERIFY_EXPIRE_MIN || 30);
    const expiresAtNew = new Date(Date.now() + expiresMinutes * 60 * 1000);

    let tokenToSend = null;

    await mySqlDb.withTransaction(async (tx) => {
      // 鎖住 user（避免同時多次 resend）
      const lockU = await tx.query(
        `SELECT id, email, email_verified_at
         FROM custaccount
         WHERE id=? FOR UPDATE`,
        [u.id]
      );
      const lu = (Array.isArray(lockU) && Array.isArray(lockU[0])) ? lockU[0][0] : lockU[0];
      if (!lu) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (lu.email_verified_at) {
        // 交易內再次確認
        tokenToSend = null;
        return;
      }

      // 找最近一筆未使用 token（同 user+email）
      const tRows = await tx.query(
        `SELECT id, token_hash, expires_at, used_at
         FROM user_email_verify_tokens
         WHERE user_id=? AND email=? AND used_at IS NULL
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [u.id, targetEmail]
      );
      const last = (Array.isArray(tRows) && Array.isArray(tRows[0])) ? tRows[0][0] : tRows[0];

      // 如果存在且未過期：直接重寄「同一 token」
      // 但我們 DB 只有 token_hash，無法還原原 token
      // ⇒ 所以「要能重寄同一 token」就必須在 DB 存明文 token（不建議）
      // ✅ 因此企業實務：每次 resend 都產生新 token，並 revoke 舊 token（更安全）
      // 你要求「token 失效就重建」，我這裡做得更嚴謹：只要 resend 就換新 token（可選擇是否 revoke 舊 token）
      if (last && revokeOld) {
        await tx.query(
          `UPDATE user_email_verify_tokens
           SET used_at=NOW()
           WHERE user_id=? AND email=? AND used_at IS NULL`,
          [u.id, targetEmail]
        );
      }

      // 建新 token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256Hex(token);

      await tx.query(
        `INSERT INTO user_email_verify_tokens
         (user_id, email, token_hash, expires_at, created_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          u.id,
          targetEmail,
          tokenHash,
          expiresAtNew,
          getClientIp(req),
          clampStr(req.headers['user-agent'], 255)
        ]
      );

      tokenToSend = token;

      await writeAuditLogTx(tx, req, {
        action: 'USER_RESEND_REGISTER_EMAIL_VERIFY',
        targetUserId: u.id,
        detail: { email: targetEmail, revokeOld }
      });
    });

    // 如果交易內發現已驗證（tokenToSend null）
    if (!tokenToSend) {
      return hideEnum ? okResponse() : safeJson(res, 200, { status: 'success', message: 'Email 已驗證，無需重寄' });
    }

    // 寄信（交易成功後）
    const baseUrl = getBaseUrl(req);
    const link = `${baseUrl}/verify-register-email?token=${encodeURIComponent(tokenToSend)}`;

    try {
      await sendMail({
        to: targetEmail,
        subject: 'TMC SHOP - 註冊 Email 驗證（重新寄送）',
        text: `請點擊以下連結完成註冊 Email 驗證（${expiresMinutes} 分鐘內有效）：\n${link}`,
        html: `
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
            <p>您好，</p>
            <p>您要求重新寄送註冊 Email 驗證信，請點擊以下連結完成驗證（<b>${expiresMinutes}</b> 分鐘內有效）：</p>
            <p><a href="${link}">${link}</a></p>
            <p>若非本人操作，請忽略本信。</p>
          </div>
        `
      });
    } catch (mailErr) {
      console.error('[resend verify] sendMail failed:', mailErr);
      // 不透露太多（避免攻擊者用來探測 SMTP 狀態）
      return safeJson(res, 500, { status: 'error', message: '寄送失敗，請稍後再試' });
    }

    // 成功回覆
    return safeJson(res, 200, {
      status: 'success',
      message: '驗證信已重新寄出，請至 Email 收信完成驗證'
    });

  } catch (e) {
    console.error('resend register verify error:', e);
    return safeJson(res, 500, { status: 'error', message: 'resend failed' });
  }
});

// 4) POST /api/auth/forgot-password 可貼版本
// 功能：
// 用 email 或 account 找使用者
// 找到就產生 token
// 可選擇 revoke 舊 token
// 寄 reset link
// 預設不洩漏帳號是否存在
// 回傳統一訊息
// ===== 忘記密碼：寄送重設連結 =====
// POST /api/auth/forgot-password
// body: { email?: string, account?: string }
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const body = req.body || {};

    const email = body.email ? normalizeEmail(body.email) : '';
    const account = body.account ? normalizeAccount(body.account) : '';

    if (!email && !account) {
      return safeJson(res, 400, { status: 'error', message: 'email/account required' });
    }
    if (email && !isValidEmail(email)) {
      return safeJson(res, 400, { status: 'error', message: 'email 格式不正確' });
    }
    if (account && !isValidAccount(account)) {
      return safeJson(res, 400, { status: 'error', message: 'account 格式不正確' });
    }

    const identifier = email || account;

    // ✅ rate limit
    const rl = forgotPasswordRateLimit(req, identifier);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
      return safeJson(res, 429, {
        status: 'error',
        message: `請稍後再試（${rl.retryAfterSec}s 後可再送）`
      });
    }

    const hideEnum = String(process.env.FORGOT_PASSWORD_HIDE_ENUM || 'true') === 'true';
    const revokeOld = String(process.env.FORGOT_PASSWORD_REVOKE_OLD || 'true') === 'true';

    // 找 user
    const rows = await mySqlDb.query(
      `SELECT id, account, email, is_disabled
       FROM custaccount
       WHERE ${email ? 'email=?' : 'account=?'}
       LIMIT 1`,
      [email ? email : account]
    );
    const u = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];

    const okResponse = () =>
      safeJson(res, 200, {
        status: 'success',
        message: '若帳號存在，系統將寄出重設密碼連結'
      });

    if (!u) {
      return hideEnum ? okResponse() : safeJson(res, 404, { status: 'error', message: 'user not found' });
    }

    if (u.is_disabled) {
      return hideEnum ? okResponse() : safeJson(res, 403, { status: 'error', message: 'account disabled' });
    }

    const targetEmail = normalizeEmail(u.email);
    if (!targetEmail || !isValidEmail(targetEmail)) {
      return hideEnum ? okResponse() : safeJson(res, 400, { status: 'error', message: 'user email invalid' });
    }

    const expiresMinutes = Number(process.env.FORGOT_PASSWORD_EXPIRE_MIN || 30);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    let rawToken = null;

    await mySqlDb.withTransaction(async (tx) => {
      // 鎖 user row，避免 race
      const lockU = await tx.query(
        `SELECT id, account, email, is_disabled
         FROM custaccount
         WHERE id=? FOR UPDATE`,
        [u.id]
      );
      const lu = (Array.isArray(lockU) && Array.isArray(lockU[0])) ? lockU[0][0] : lockU[0];
      if (!lu || lu.is_disabled) {
        rawToken = null;
        return;
      }

      if (revokeOld) {
        await tx.query(
          `UPDATE forgot_password_tokens
           SET used_at = NOW()
           WHERE user_id=? AND used_at IS NULL`,
          [u.id]
        );
      }

      rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256Hex(rawToken);

      await tx.query(
        `INSERT INTO forgot_password_tokens
         (user_id, email, token_hash, expires_at, created_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          u.id,
          targetEmail,
          tokenHash,
          expiresAt,
          getClientIp(req),
          clampStr(req.headers['user-agent'], 255)
        ]
      );

      await writeAuditLogTx(tx, req, {
        action: 'USER_FORGOT_PASSWORD_REQUEST',
        targetUserId: u.id,
        detail: { email: targetEmail }
      });
    });

    if (!rawToken) {
      return hideEnum ? okResponse() : safeJson(res, 403, { status: 'error', message: 'account disabled' });
    }

    const baseUrl = getBaseUrl(req);
    const link = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

    try {
      await sendMail({
        to: targetEmail,
        subject: 'TMC SHOP - 重設密碼',
        text: `請點擊以下連結重設密碼（${expiresMinutes} 分鐘內有效）：\n${link}`,
        html: `
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
            <p>您好，</p>
            <p>您要求重設 TMC SHOP 密碼，請點擊以下連結完成設定（<b>${expiresMinutes}</b> 分鐘內有效）：</p>
            <p><a href="${link}">${link}</a></p>
            <p>若非本人操作，請忽略本信。</p>
          </div>
        `
      });
    } catch (mailErr) {
      console.error('[forgot-password] sendMail failed:', mailErr);
      return safeJson(res, 500, { status: 'error', message: '寄送失敗，請稍後再試' });
    }

    return okResponse();

  } catch (e) {
    console.error('forgot password error:', e);
    return safeJson(res, 500, { status: 'error', message: 'forgot password failed' });
  }
});

// 5) POST /api/auth/reset-password 可貼版本
// 功能：
// 用 token 找 forgot_password_tokens
// 檢查不存在 / 已使用 / 過期
// 用 passwordPolicyCheck() 驗證新密碼
// 新密碼不可與舊密碼相同
// 更新 custaccount.password
// password_reset_at = NOW()
// password_reset_by = NULL
// token used_at = NOW()
// revoke 所有 refresh tokens
// audit log
// ===== 重設密碼：用 token 設定新密碼 =====
// POST /api/auth/reset-password
// body: { token, newPassword }
router.post('/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!token || token.length < 20) {
      return safeJson(res, 400, { status: 'error', message: 'invalid token' });
    }
    if (!newPassword) {
      return safeJson(res, 400, { status: 'error', message: 'newPassword required' });
    }

    const tokenHash = sha256Hex(token);

    // 先查 token
    const rows = await mySqlDb.query(
      `SELECT id, user_id, email, expires_at, used_at
       FROM forgot_password_tokens
       WHERE token_hash=? LIMIT 1`,
      [tokenHash]
    );
    const rec = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];

    if (!rec) return safeJson(res, 400, { status: 'error', message: 'token not found' });
    if (rec.used_at) return safeJson(res, 400, { status: 'error', message: 'token already used' });

    const exp = new Date(rec.expires_at);
    if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
      return safeJson(res, 400, { status: 'error', message: 'token expired' });
    }

    await mySqlDb.withTransaction(async (tx) => {
      // 鎖 token row
      const chk = await tx.query(
        `SELECT id, user_id, email, expires_at, used_at
         FROM forgot_password_tokens
         WHERE id=? FOR UPDATE`,
        [rec.id]
      );
      const c = (Array.isArray(chk) && Array.isArray(chk[0])) ? chk[0][0] : chk[0];

      if (!c) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (c.used_at) {
        const err = new Error('ALREADY_USED');
        err.code = 'ALREADY_USED';
        throw err;
      }

      const exp2 = new Date(c.expires_at);
      if (Number.isFinite(exp2.getTime()) && exp2.getTime() < Date.now()) {
        const err = new Error('EXPIRED');
        err.code = 'EXPIRED';
        throw err;
      }

      // 讀 user
      const uRows = await tx.query(
        `SELECT id, account, password, is_disabled
         FROM custaccount
         WHERE id=? LIMIT 1`,
        [c.user_id]
      );
      const u = (Array.isArray(uRows) && Array.isArray(uRows[0])) ? uRows[0][0] : uRows[0];

      if (!u) {
        const err = new Error('USER_NOT_FOUND');
        err.code = 'USER_NOT_FOUND';
        throw err;
      }
      if (u.is_disabled) {
        const err = new Error('ACCOUNT_DISABLED');
        err.code = 'ACCOUNT_DISABLED';
        throw err;
      }

      // ✅ 套用 security.js 密碼規則
      const pwdErr = passwordPolicyCheck(newPassword, u.account);
      if (pwdErr) {
        const err = new Error(pwdErr);
        err.code = 'PASSWORD_POLICY';
        err.userMessage = pwdErr;
        throw err;
      }

      const safePwd = newPassword.slice(0, SECURITY_CONFIG.PWD_MAX);

      // 不可與舊密碼相同
      const same = await bcrypt.compare(safePwd, u.password);
      if (same) {
        const err = new Error('新密碼不可與舊密碼相同');
        err.code = 'PASSWORD_SAME';
        throw err;
      }

      const hash = await bcrypt.hash(safePwd, 12);

      await tx.query(
        `UPDATE custaccount
         SET password=?,
             password_reset_at=NOW(),
             password_reset_by=NULL,
             update_date=CURRENT_TIMESTAMP()
         WHERE id=?`,
        [hash, u.id]
      );

      // token used
      await tx.query(
        `UPDATE forgot_password_tokens
         SET used_at=NOW()
         WHERE id=?`,
        [c.id]
      );

      // revoke 全部 refresh token（若你有這張表）
      try {
        await tx.query(
          `UPDATE auth_refresh_tokens
           SET revoked_at=NOW()
           WHERE user_id=? AND revoked_at IS NULL`,
          [u.id]
        );
      } catch (rtErr) {
        // 若你的專案沒有 auth_refresh_tokens 表，也不讓整個失敗
        console.warn('[reset-password] revoke refresh token skipped:', rtErr?.message || rtErr);
      }

      await writeAuditLogTx(tx, req, {
        action: 'USER_RESET_PASSWORD_BY_TOKEN',
        targetUserId: u.id,
        detail: { email: c.email }
      });
    });

    return safeJson(res, 200, {
      status: 'success',
      message: '密碼已重設，請重新登入'
    });

  } catch (e) {
    if (e?.code === 'NOT_FOUND') return safeJson(res, 400, { status: 'error', message: 'token not found' });
    if (e?.code === 'ALREADY_USED') return safeJson(res, 400, { status: 'error', message: 'token already used' });
    if (e?.code === 'EXPIRED') return safeJson(res, 400, { status: 'error', message: 'token expired' });
    if (e?.code === 'USER_NOT_FOUND') return safeJson(res, 404, { status: 'error', message: 'user not found' });
    if (e?.code === 'ACCOUNT_DISABLED') return safeJson(res, 403, { status: 'error', message: 'account disabled' });
    if (e?.code === 'PASSWORD_POLICY') return safeJson(res, 400, { status: 'error', message: e.userMessage || 'password invalid' });
    if (e?.code === 'PASSWORD_SAME') return safeJson(res, 400, { status: 'error', message: '新密碼不可與舊密碼相同' });

    console.error('reset password error:', e);
    return safeJson(res, 500, { status: 'error', message: 'reset password failed' });
  }
});



// // 2) GET /api/auth/verify-email（註冊驗證完成）
// router.get('/auth/verify-email', async (req, res) => {
//   try {
//     const token = String(req.query?.token || '');
//     if (!token || token.length < 20) return res.status(400).json({ message: 'invalid token' });

//     const tokenHash = sha256Hex(token);

//     const rows = await mySqlDb.query(
//       `SELECT id, user_id, email, expires_at, used_at
//        FROM user_email_verify_tokens
//        WHERE token_hash=? LIMIT 1`,
//       [tokenHash]
//     );
//     const rec = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
//     if (!rec) return res.status(400).json({ message: 'token not found' });
//     if (rec.used_at) return res.status(400).json({ message: 'token already used' });

//     const exp = new Date(rec.expires_at);
//     if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
//       return res.status(400).json({ message: 'token expired' });
//     }

//     await mySqlDb.withTransaction(async (tx) => {
//       const chk = await tx.query(
//         `SELECT id, user_id, email, expires_at, used_at
//          FROM user_email_verify_tokens
//          WHERE id=? FOR UPDATE`,
//         [rec.id]
//       );
//       const c = (Array.isArray(chk) && Array.isArray(chk[0])) ? chk[0][0] : chk[0];
//       if (!c || c.used_at) {
//         const err = new Error('ALREADY_USED'); err.code = 'ALREADY_USED'; throw err;
//       }

//       await tx.query(
//         `UPDATE custaccount
//          SET email_verified_at=NOW(),
//              update_date=CURRENT_TIMESTAMP()
//          WHERE id=?`,
//         [c.user_id]
//       );

//       await tx.query(
//         `UPDATE user_email_verify_tokens
//          SET used_at=NOW()
//          WHERE id=?`,
//         [c.id]
//       );

//       await writeAuditLogTx(tx, req, {
//         action: 'USER_VERIFY_REGISTER_EMAIL',
//         targetUserId: c.user_id,
//         detail: { email: c.email }
//       });
//     });

//     return res.status(200).json({ status: 'success', message: 'email verified' });

//   } catch (e) {
//     if (e?.code === 'ALREADY_USED') return res.status(400).json({ message: 'token already used' });
//     console.error('verify register email error:', e);
//     return res.status(500).json({ message: 'verify failed' });
//   }
// });


// 登入：bcrypt.compare + 發 access/refresh cookie + 存 refresh hash
router.post('/login', loginLimiter, async (req, res) => {
  const data = req.body;

  try {
    requireEnv('JWT_SECRET');
    requireEnv('JWT_REFRESH_SECRET');

    const rows = await mySqlDb.query(
      "SELECT id, account, password, type, name, is_disabled FROM custaccount WHERE account = ? LIMIT 1",
      [data.account]
    );
    // const rows = await mySqlDb.query(
    //   'SELECT id, account, password, type, name FROM custaccount WHERE account = ? LIMIT 1',
    //   [data.account]
    // );
   
    if (!rows || rows.length === 0) {
      return safeJson(res, 400, { status: 'error', message: 'Invalid account or password' });
    }



    const user = rows[0];
    const ok = await bcrypt.compare(data.password || '', user.password);
    if (!ok) {
      return safeJson(res, 400, { status: 'error', message: 'Invalid account or password' });
    }

    const accessTtl = process.env.ACCESS_TOKEN_TTL || '15m';
    const refreshTtl = process.env.REFRESH_TOKEN_TTL || '30d';

    if (user.is_disabled === 1 || user.is_disabled === true) {
      return res.status(403).json({ status: 'error', message: 'Account disabled' });
    }

    const accessToken = jwt.sign(
      { id: user.id, account: user.account, type: user.type, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: accessTtl }
    );

    const jti = newJti();
    const refreshToken = jwt.sign(
      { sub: String(user.id), jti },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: refreshTtl }
    );

    const refreshHash = await bcrypt.hash(refreshToken, 12);
    const expiresAt = new Date(Date.now() + parseTtlToMs(refreshTtl, 30 * 24 * 60 * 60 * 1000));

    //B-3) 修改 login：不要再 revoke 全部 refresh（改成「同裝置取代」）
    //改成「只撤銷同 device 的舊 refresh」：
    const deviceId = getOrSetDeviceId(req, res);
    const ua = (req.headers['user-agent'] || '').slice(0, 255);
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim().slice(0, 45);

    // ✅ 同裝置取代（多裝置共存）
    await mySqlDb.query(
      "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL",
      [user.id, deviceId]
    );

    await mySqlDb.query(
      "INSERT INTO auth_refresh_tokens (user_id, device_id, token_hash, jti, expires_at, user_agent, ip, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
      [user.id, deviceId, refreshHash, jti, expiresAt, ua, ip]
    );

    // // 單裝置策略：撤銷舊 refresh
    // await mySqlDb.query(
    //   'UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    //   [user.id]
    // );

    // await mySqlDb.query(
    //   'INSERT INTO auth_refresh_tokens (user_id, token_hash, jti, expires_at) VALUES (?, ?, ?, ?)',
    //   [user.id, refreshHash, jti, expiresAt]
    // );

    res.cookie('access_token', accessToken, { ...cookieCommon(), maxAge: parseTtlToMs(accessTtl) });
    res.cookie('refresh_token', refreshToken, { ...cookieCommon(), path: '/api/refresh', maxAge: parseTtlToMs(refreshTtl) });

    return safeJson(res, 200, { status: 'success' });
  } catch (err) {
    console.error('Login error:', err);
    return safeJson(res, 500, { status: 'error', message: 'Login failed' });
  }
});

// ① 後端：把 /api/me 改成回傳 perms（建議做，header 才能判斷）
// 你目前 /api/me 大多只回 { user: req.user }（JWT payload），不含 perms，header.js 沒辦法用 permissions 判斷。
// 這樣前端就能拿到：me.data.perms（例如包含 product:write、user:manage）
router.get('/me', requireAuthAuto, async (req, res) => {
  try {
    const user = req.user;

    // ✅ 從 DB 取 permissions（RBAC）
    const r = await mySqlDb.query(
      `SELECT DISTINCT p.code AS perm
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`,
      [user.id]
    );

    const rows = (Array.isArray(r) && Array.isArray(r[0])) ? r[0] : r;
    const perms = (rows || []).map(x => x.perm).filter(Boolean);

    return safeJson(res, 200, { user, perms });
  } catch (e) {
    console.error('GET /api/me error:', e);
    return safeJson(res, 500, { message: 'me failed' });
  }
});

// 取得目前登入者（靠 access_token cookie）
// router.get('/me', requireAuthAuto, (req, res) => {
//   return safeJson(res, 200, { user: req.user });
// });

// Refresh：旋轉rotate refresh token + 更新 cookies
router.post('/refresh', async (req, res) => {
  console.log('[refresh] cookie header=', req.headers.cookie);
  console.log('[refresh] cookies keys=', Object.keys(req.cookies || {}), 'has refresh_token=', !!req.cookies?.refresh_token);

  try {
    requireEnv('JWT_SECRET');
    requireEnv('JWT_REFRESH_SECRET');

    const token = req.cookies?.refresh_token;
    if (!token) return safeJson(res, 401, { message: 'No refresh token' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return safeJson(res, 401, { message: 'Invalid refresh token' });
    }

    const userId = Number(payload.sub);
    const jti = payload.jti;

    //✅ 改成（就是“新增查欄位”）：
    const rows = await mySqlDb.query(
      'SELECT id, user_id, device_id, token_hash, expires_at, revoked_at FROM auth_refresh_tokens WHERE jti = ? LIMIT 1',
      [jti]
    );
    // const rows = await mySqlDb.query(
    //   'SELECT id, user_id, token_hash, expires_at, revoked_at FROM auth_refresh_tokens WHERE jti = ? LIMIT 1',
    //   [jti]
    // );
    if (!rows || rows.length === 0) return safeJson(res, 401, { message: 'Refresh not found' });

    const rt = rows[0];
    if (rt.revoked_at) return safeJson(res, 401, { message: 'Refresh revoked' });
    if (new Date(rt.expires_at).getTime() <= Date.now()) return safeJson(res, 401, { message: 'Refresh expired' });

    const ok = await bcrypt.compare(token, rt.token_hash);
    if (!ok) return safeJson(res, 401, { message: 'Refresh mismatch' });

    const users = await mySqlDb.query('SELECT id, account, type, name FROM custaccount WHERE id = ? LIMIT 1', [userId]);
    if (!users || users.length === 0) return safeJson(res, 401, { message: 'User not found' });

    const user = users[0];

    await mySqlDb.query(
      'UPDATE auth_refresh_tokens SET last_used_at = NOW() WHERE id = ?',
      [rt.id]
    );
    // 旋轉rotate：撤銷舊 refresh
    await mySqlDb.query('UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [rt.id]);

    const accessTtl = process.env.ACCESS_TOKEN_TTL || '15m';
    const refreshTtl = process.env.REFRESH_TOKEN_TTL || '30d';

    const newAccess = jwt.sign(
      { id: user.id, account: user.account, type: user.type, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: accessTtl }
    );

    const newJ = newJti();
    const newRefresh = jwt.sign(
      { sub: String(user.id), jti: newJ },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: refreshTtl }
    );

    const newHash = await bcrypt.hash(newRefresh, 12);
    const expiresAt = new Date(Date.now() + parseTtlToMs(refreshTtl, 30 * 24 * 60 * 60 * 1000));

        // ✅ 3) (插入新 refresh) 帶 device_id/ua/ip/last_used_at
    const ua = req.get('user-agent') || '';
    const ip =
      (req.headers['x-forwarded-for']?.split(',')[0] || '').trim() ||
      req.ip ||
      '';

    await mySqlDb.query(
      'INSERT INTO auth_refresh_tokens (user_id, device_id, token_hash, jti, expires_at, user_agent, ip, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [user.id, rt.device_id, newHash, newJ, expiresAt, ua, ip]
    );
    // await mySqlDb.query(
    //   'INSERT INTO auth_refresh_tokens (user_id, token_hash, jti, expires_at) VALUES (?, ?, ?, ?)',
    //   [user.id, newHash, newJ, expiresAt]
    // );

    res.cookie('access_token', newAccess, { ...cookieCommon(), maxAge: parseTtlToMs(accessTtl) });
    res.cookie('refresh_token', newRefresh, { ...cookieCommon(), path: '/api/refresh', maxAge: parseTtlToMs(refreshTtl) });

    return safeJson(res, 200, { status: 'success' });
  } catch (err) {
    console.error('Refresh error:', err);
    return safeJson(res, 500, { message: 'Refresh failed' });
  }
});

// Logout：不強制 requireAuth（access 過期也能登出）
// - 若 access 還有效：能 revoke 該 user 的 refresh
// - 不管如何：都清 cookie
router.post('/logout', async (req, res) => {
  try {
    const access = req.cookies?.access_token;// 從 Cookie 中讀取 access_token
    if (access) {
      try {
        const payload = jwt.verify(access, process.env.JWT_SECRET);
        if (payload?.id) {
          await mySqlDb.query(
            'UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
            [payload.id]
          );
        }
      } catch {
        // access 失效就跳過 revoke（仍會清 cookie）
      }
    }
  } catch (e) {
    // 忽略
  }

  res.clearCookie('access_token', cookieCommon());
  res.clearCookie('refresh_token', { ...cookieCommon(), path: '/api/refresh' });

  return safeJson(res, 200, { status: 'success' });
});

// 1-3 下單流程（transaction）改成「預扣庫存 + Pending」
// 你之前已經做了 SELECT ... FOR UPDATE + 扣庫存，現在只要加上：
// 設定 expires_at（例如 15 分鐘）
// 訂單寫入 trade_no（MerchantTradeNo）
// 訂單 status2=PENDING
// 明細 reserved_qty=qty
// 下面是一段「可直接替換」你現有 /submitOrder 的核心交易片段（保留你後面產生金流表單的邏輯就好）
const HOLD_MINUTES = Number(process.env.INVENTORY_HOLD_MINUTES || 15);

router.post('/submitOrder', requireAuthAuto, async (req, res) => {
  const order = req.body?.order;
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Empty items' });
  }

  try {
    const now = Date.now();
    const expiresAt = new Date(now + HOLD_MINUTES * 60 * 1000);
    const tradeNo = _uuid(); // 建議替換成更符合綠界規則的 20 碼英數（你現用的也可先跑）

    const result = await mySqlDb.withTransaction(async (tx) => {
      // 1) 整理 items（去重合併 qty）
      const qtyMap = new Map();
      for (const x of order.items) {
        const pid = Number(x.productId);
        const qty = Number(x.qty);
        if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= 0) continue;
        qtyMap.set(pid, (qtyMap.get(pid) || 0) + qty);
      }
      const uniqItems = [...qtyMap.entries()].map(([productId, qty]) => ({ productId, qty }));
      if (uniqItems.length === 0) throw Object.assign(new Error('Invalid items'), { code: 'BAD_REQ' });

      const ids = uniqItems.map(x => x.productId);

      // 2) 鎖商品
      const rows = await tx.query(
        `SELECT id, name, amount, inventory, status FROM product WHERE id IN (?) FOR UPDATE`,
        [ids]
      );
      const prodMap = new Map(rows.map(r => [r.id, r]));

      // 3) 驗證 + 算 total
      let total = 0;
      const orderItems = [];
      for (const it of uniqItems) {
        const p = prodMap.get(it.productId);
        if (!p) throw Object.assign(new Error(`Product not found: ${it.productId}`), { code: 'BAD_REQ' });
        if (p.status !== 'A') throw Object.assign(new Error(`Product not available: ${p.name}`), { code: 'BAD_REQ' });
        if (p.inventory < it.qty) throw Object.assign(new Error(`Insufficient inventory: ${p.name}`), { code: 'BAD_REQ' });

        const unitPrice = Number(p.amount);
        const lineTotal = unitPrice * it.qty;
        total += lineTotal;

        orderItems.push({ productId: p.id, productName: p.name, unitPrice, qty: it.qty, lineTotal });
      }
      total = Math.round(total);

      // 4) 建立 PENDING 訂單（帶 trade_no / expires_at）
      const ins = await tx.query(
        `INSERT INTO shop_order (trade_no, payment_method, cust_id, cust_name, phone, address, status, status2, total, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        [tradeNo, order.payment, req.user.id, order.name, order.phone, order.address, '1', total, expiresAt]
      );
      const orderId = ins.insertId;

      // 5) 寫明細（reserved_qty = qty）
      for (const it of orderItems) {
        await tx.query(
          `INSERT INTO shop_order_item (order_id, product_id, product_name, unit_price, qty, reserved_qty, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [orderId, it.productId, it.productName, it.unitPrice, it.qty, it.qty, it.lineTotal]
        );
      }

      // 6) 預扣庫存（直接扣 inventory；未付款再回補）
      for (const it of orderItems) {
        await tx.query(`UPDATE product SET inventory = inventory - ? WHERE id = ?`, [it.qty, it.productId]);
      }

      return { orderId, total, tradeNo, orderItems, expiresAt };
    });

    // 交易成功後 → 產生金流表單（TotalAmount 用 result.total，TradeNo 用 result.tradeNo）
    // ⚠️ 金流欄位/驗證請依綠界文件（CheckMacValue 等）落實
    // 回傳前端 result.html 讓前端跳轉付款頁
    return res.status(200).json({ status: 'success', orderId: result.orderId, tradeNo: result.tradeNo, total: result.total });

  } catch (err) {
    console.error('submitOrder error:', err);
    if (err.code === 'BAD_REQ') return res.status(400).json({ status: 'error', message: err.message });
    return res.status(500).json({ status: 'error', message: 'submitOrder failed' });
  }
});
/* =========================
 * A-3) apis/api.js：把 submitOrder 改成「交易 + 鎖庫存 + 扣庫存」
核心：用 SELECT ... FOR UPDATE 鎖住要買的商品列，確認庫存，再扣庫存。
直接用下面取代你目前的 submitOrder（這版會：後端算 total、寫 order、寫 items、扣庫存，全在同一個 transaction）
 * ========================= */

// 方案 B（相容舊碼）：後端直接補 /api/history
router.get('/history', requireAuthAuto, async (req, res) => {
  const rows = await mySqlDb.query(
    `SELECT * FROM shop_order WHERE cust_id=? ORDER BY id DESC LIMIT 200`,
    [req.user.id]
  );
  res.status(200).json({ orders: rows });
});


/* =========================
 * 後臺管理 API（需 Admin）
 * ========================= */

// 抓到真正會造成「IN 沒 OUT」的致命點了，而且就在你貼的這行：
// router.post('/product', requireAuth, requirePermission(...), upload.single('img'), async ...)
// 你現在用的 middlewares/auth.js 裡：
// function requireAuth(options = {}) {
//   return async (req, res, next) => { ... }
// }
// 也就是說 requireAuth 是「工廠函式」，必須要呼叫 requireAuth() 才會得到真正的 middleware。
// 你現在寫 requireAuth（沒括號）時，Express 會把它當成 middleware 呼叫成：
// requireAuth(req, res, next)
// 但 requireAuth(req,res,next) 會回傳一個 async function（真正 middleware），卻不會被執行，而且 requireAuth 這次呼叫也沒有 next()、也沒有 res.json() —— 所以 request 就會 永遠卡住，造成你看到的：

// [IN] POST /api/product 沒有 [OUT]
// [IN] DELETE /api/product/:id 沒有 [OUT]
// ✅ 這就是 100% 會造成「IN 沒 OUT」的原因（跟 SQL / Mongo 無關）。
// ✅ 修正方法：把 requireAuth 改成 requireAuthAuto 或 requireAuth()（重點是要「有括號」）
// 你在 auth.js 已經有提供「可直接用的 middleware」：
// requireAuthAuto（已經是 middleware，不用括號）
// requireAuthSensitive（已經是 middleware，不用括號）

// 或用 requireAuth()（要括號）

// router.post('/product/_ping', requireAuth, requirePermission('product:write'), (req, res) => {
//   return res.json({ ok: true });
// });

// ✅ 相容 mysql2/promise 與你自包的 query 回傳
async function dbQuery(db, sql, params = []) {
  const r = await db.query(sql, params);
  // mysql2/promise: [rows, fields]
  if (Array.isArray(r) && Array.isArray(r[0])) return r[0];
  // mysql2/promise INSERT/UPDATE: [result, fields]
  if (Array.isArray(r) && r[0] && typeof r[0] === 'object' && ('affectedRows' in r[0] || 'insertId' in r[0])) return r[0];
  // 你自包：直接 rows 或 result object
  return r;
}


// ✅ 任何 promise 超過時間直接 reject（避免 Mongo 卡死造成 IN 沒 OUT）
function withTimeout(promise, ms = 1500, label = 'timeout') {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// 1) 產品 API：整段改成這樣（最推薦）
// ✅ 新增商品（整段覆蓋）

// 建議加：避免 async 錯誤漏掉
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ✅ 注意：requireAuthAuto 是 middleware（不用括號）
router.post(
  '/product',
  requireAuthAuto,
  requirePermission('product:write'),
  upload.single('img'),
  asyncHandler(async (req, res) => {
    const data = req.body;
    const file = req.file;

    let imgString = null;
    if (file) {
      if (file.buffer) {
        imgString = `data:${file.mimetype};base64,` + file.buffer.toString('base64');
      } else if (file.path) {
        const buf = fs.readFileSync(file.path);
        imgString = `data:${file.mimetype};base64,` + buf.toString('base64');
      }
    }

    const result = await dbQuery(
      mySqlDb,
      'INSERT INTO product (name, description, amount, inventory, status) VALUES (?, ?, ?, ?, ?);',
      [data.name, data.desc, data.amount, data.inventory, data.status]
    );

    const newId = result.insertId || result?.[0]?.insertId;

    // ✅ 先回應，避免任何外部依賴卡住
    res.status(200).json({ message: 'Product added successfully', id: newId });

    // ✅ Mongo 非阻塞
    (async () => {
      try {
        const db = await getMongoDb('products');
        await db.collection('image').updateOne(
          { id: newId },
          { $set: { image: imgString } },
          { upsert: true }
        );
      } catch (e) {
        console.error('[Mongo] save image failed (non-blocking):', e);
      }
    })();
  })
);


// ✅ 刪除商品（整段覆蓋）
router
  .route('/product/:id')
  .delete(
    requireAuthAuto,
    requirePermission('product:write'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return safeJson(res, 400, { status: 'error', message: 'Invalid id' });

      const result = await dbQuery(mySqlDb, 'DELETE FROM product WHERE id = ?;', [id]);
      const affected = result.affectedRows ?? result?.[0]?.affectedRows ?? 0;

      if (affected <= 0) return safeJson(res, 404, { status: 'error', message: 'Product not found' });

      res.status(200).json({ ok: true });

      // Mongo 非阻塞
      (async () => {
        try {
          const db = await getMongoDb('products');
          await db.collection('image').deleteOne({ id });
        } catch (e) {
          console.error('[Mongo] delete image failed (non-blocking):', e);
        }
      })();
    })
  )
  .put(
    requireAuthAuto,
    requirePermission('product:write'),
    upload.single('img'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return safeJson(res, 400, { status: 'error', message: 'Invalid id' });

      const data = req.body;
      const file = req.file;

      let imgString = null;
      if (file?.buffer) {
        imgString = `data:${file.mimetype};base64,` + file.buffer.toString('base64');
      }

      const result = await dbQuery(
        mySqlDb,
        'UPDATE product SET name=?, description=?, amount=?, inventory=?, status=? WHERE id=?',
        [data.name, data.desc, data.amount, data.inventory, data.status, id]
      );

      const affected = result.affectedRows ?? result?.[0]?.affectedRows ?? 0;
      if (affected <= 0) return safeJson(res, 404, { status: 'error', message: 'Product not found' });

      res.status(200).json({ ok: true });

      if (imgString) {
        (async () => {
          try {
            const db = await getMongoDb('products');
            await db.collection('image').updateOne({ id }, { $set: { image: imgString } }, { upsert: true });
          } catch (e) {
            console.error('[Mongo] update image failed (non-blocking):', e);
          }
        })();
      }
    })
  )


// ✅ 修改（修正版：同樣要解構 result）
  .put(
    requireAuth,
    requirePermission('product:write'),
    upload.single('img'),
    async (req, res, next) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return safeJson(res, 400, { status: 'error', message: 'Invalid id' });

      const data = req.body;
      const file = req.file;

      let imgString = null;
      if (file && file.buffer) {
        imgString = `data:${file.mimetype};base64,` + file.buffer.toString('base64');
      }

      try {
        const [result] = await mySqlDb.query(
          'UPDATE product SET name = ?, description = ?, amount = ?, inventory = ?, status = ? WHERE id = ?',
          [data.name, data.desc, data.amount, data.inventory, data.status, id]
        );

        if (result.affectedRows <= 0) {
          return safeJson(res, 404, { status: 'error', message: 'Product not found' });
        }

        if (imgString) {
          const db = await getMongoDb('products');
          const imageCollection = db.collection('image');
          await imageCollection.updateOne({ id }, { $set: { image: imgString } }, { upsert: true });
        }

        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error('更新商品時發生錯誤:', err);
        return next(err);
      }
    }
  );

// ✅ 正確做法（最終版）
// 流程必須是：
// DELETE user_roles
// INSERT 新 roleIds
// 再 chk 是否包含 admin（或更簡單：直接用 roleIds 推算）
// UPDATE custaccount.type
// 我建議你用 最穩且不用再查一次 DB 的方法：
// 直接用 roleIds 判斷是否包含 admin role。
// ✅ 版本 A（最推薦）：用 roleIds 推算 type（少一次 SQL）
// 先把 admin 角色 id 取出來（一次查 DB）：
router.post('/admin/users/:id/roles',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {

    const userId = Number(req.params.id);
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(Number).filter(Number.isFinite) : [];

    // ✅ 先拿 admin role id（你的 roles.code 是小寫 admin）
    const adminRows = await mySqlDb.query(`SELECT id FROM roles WHERE LOWER(code)='admin' LIMIT 1`);
    const adminId = adminRows?.[0]?.id ?? adminRows?.[0]?.[0]?.id;
    const nextType = adminId && roleIds.includes(Number(adminId)) ? 'A' : 'U';

    await mySqlDb.withTransaction(async (tx) => {
      await tx.query(`DELETE FROM user_roles WHERE user_id=?`, [userId]);

      for (const rid of roleIds) {
        await tx.query(`INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`, [userId, rid]);
      }

      await tx.query(`UPDATE custaccount SET type=?, update_date=NOW() WHERE id=?`, [nextType, userId]);
    });

    invalidateUserPermCache(userId);

    // ✅ 這裡你若還沒有 writeAuditLog，先不要呼叫（你之前有 writeAuditLog is not defined）
    // await writeAuditLog(req, { action:'ROLE_UPDATE', targetUserId:userId, detail:{ roleIds }});
    await writeAuditLog(req, {
      action: 'ROLE_UPDATE',
      targetUserId: userId,
      detail: { roleIds }
    });
    return res.status(200).json({ status: 'success', type: nextType });
  }
);


// 2-1 列表：回 users + roles（直接在列表顯示角色）
router.get('/admin/users', requireAuthAuto, requirePermission('user:manage'), async (req, res) => {
  const users = await mySqlDb.query(
    `SELECT id, account, type, name, cellphone, email, create_date, update_date,
            is_disabled, disabled_at, disabled_reason
     FROM custaccount
     ORDER BY id DESC
     LIMIT 500`
  );

  const roleRows = await mySqlDb.query(
    `SELECT ur.user_id, r.id AS role_id, r.code, r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id`
  );

  const map = new Map();
  for (const rr of roleRows) {
    if (!map.has(rr.user_id)) map.set(rr.user_id, []);
    map.get(rr.user_id).push({ id: rr.role_id, code: rr.code, name: rr.name });
  }

  const merged = users.map(u => ({ ...u, roles: map.get(u.id) || [] }));
  res.status(200).json({ users: merged });
});

// 2-2 角色清單
router.get('/admin/roles', requireAuthAuto, requirePermission('user:manage'), async (req, res) => {
  const roles = await mySqlDb.query(`SELECT id, code, name FROM roles ORDER BY id`);
  res.status(200).json({ roles });
});

// 1) DB：新增審計欄位 + 操作紀錄表 admin_audit_log
// 1-1 custaccount 加「最後一次重設密碼/停用」審計欄位
// 你前面已加 is_disabled/disabled_at/disabled_reason，這裡再補「誰做的」。

// 3) API：補 /api/admin/users/:id 詳情 + log 查詢
// 3-1 ✅ /api/admin/users/:id（含審計欄位：誰重設、誰停用）
router.get('/admin/users/:id', requireAuthAuto, requirePermission('user:manage'), async (req, res) => {
  const userId = Number(req.params.id);

  const rows = await mySqlDb.query(
    `SELECT c.id, c.account, c.type, c.name, c.cellphone, c.email, c.birthday,
            c.create_date, c.update_date,
            c.is_disabled, c.disabled_at, c.disabled_reason, c.disabled_by,
            c.password_reset_at, c.password_reset_by,
            dis.account AS disabled_by_account,
            pr.account AS password_reset_by_account
     FROM custaccount c
     LEFT JOIN custaccount dis ON dis.id = c.disabled_by
     LEFT JOIN custaccount pr  ON pr.id  = c.password_reset_by
     WHERE c.id = ?
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) return res.status(404).json({ message: 'User not found' });

  // roles
  const roles = await mySqlDb.query(
    `SELECT r.id, r.code, r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
     ORDER BY r.id`,
    [userId]
  );

  res.status(200).json({ user: rows[0], roles });
});

// ① 先補一支你缺的 API：GET /api/admin/audit
// （如果你已經有就跳過，確認回傳欄位有 actor_account / detail_json）
// ✅ 後台：查 audit log（可用 target_user_id / limit / offset）
router.get('/admin/audit', requireAuthAuto, requirePermission('user:manage'), async (req, res) => {
  const targetUserId = req.query.target_user_id ? Number(req.query.target_user_id) : null;
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const where = [];
  const params = [];

  if (Number.isFinite(targetUserId)) {
    where.push('l.target_user_id = ?');
    params.push(targetUserId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const logs = await mySqlDb.query(
    `SELECT l.id, l.actor_user_id, a.account AS actor_account,
            l.action, l.target_user_id,
            l.ip, l.user_agent, l.detail_json, l.created_at
     FROM admin_audit_log l
     LEFT JOIN custaccount a ON a.id = l.actor_user_id
     ${whereSql}
     ORDER BY l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.status(200).json({ logs, limit, offset });
});


// B) 補你缺的「GET /admin/users/:id/roles」 → 解 404
// 這支一補上，你的前端 openRoleModal() 就會正常拿到 current roles。
// ✅ 2-x 取得單一使用者角色（給前端 openRoleModal 用）
router.get('/admin/users/:id/roles',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return res.status(400).json({ message: 'invalid id' });

    const rows = await dbQuery(mySqlDb,
      `SELECT r.id, r.code, r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?
       ORDER BY r.id`,
      [userId]
    );

    return res.status(200).json({ roles: rows });
  }
);

// ================================
// ✅ Security APIs (copy & paste)
// ================================

// 小工具：mysql2 execute 不支援 IN (?) + array，所以必須自己展開 (?, ?, ?)
function buildInPlaceholders(arr) {
  const list = Array.isArray(arr) ? arr : [];
  if (!list.length) return { clause: '(NULL)', params: [] }; // 永遠不會命中
  return { clause: `(${list.map(() => '?').join(',')})`, params: list };
}

/**
 * ✅ (1) 新增人員：長度保護 + roleIds 驗證存在 + 審計 + 依 ADMIN 角色同步 type
 * POST /api/admin/users
 */
router.post(
  '/admin/users',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    try {
      const body = req.body || {};

      const account = normalizeAccount(body.account); // security.js 內有長度限制
      const email = normalizeEmail(body.email);
      const name = String(body.name ?? '').trim().slice(0, 50);
      const cellphone = String(body.cellphone ?? '').trim().slice(0, 15);
      const password = String(body.password || '');

      if (!account || !password || !email || !cellphone) {
        return res.status(400).json({
          message: 'account / password / email / cellphone are required'
        });
      }
      if (!isValidAccount(account)) {
        return res.status(400).json({ message: 'account 格式不正確（例：staff01 / admin.test）' });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: 'email 格式不正確' });
      }

      const pwdErr = passwordPolicyCheck(password, account);
      if (pwdErr) return res.status(400).json({ message: pwdErr });

      // roleIds：轉型 + 去重 + 限制數量（避免濫用）
      const rawRoleIds = Array.isArray(body.roleIds)
        ? body.roleIds.map(Number).filter(Number.isFinite)
        : [];
      const roleIds = Array.from(new Set(rawRoleIds)).slice(0, 50);

      // 驗證 roles 存在（✅ 修正：IN (?,?,?) 展開）
      let validRoleIds = [];
      if (roleIds.length) {
        const { clause, params } = buildInPlaceholders(roleIds);
        const rows = await mySqlDb.query(`SELECT id FROM roles WHERE id IN ${clause}`, params);
        const list = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0] : rows;
        validRoleIds = (list || []).map(r => Number(r.id)).filter(Number.isFinite);
      }

      // admin role id（以 code 判斷）
      const adminRows = await mySqlDb.query(`SELECT id FROM roles WHERE LOWER(code)='admin' LIMIT 1`);
      const adminRow = (Array.isArray(adminRows) && Array.isArray(adminRows[0])) ? adminRows[0][0] : adminRows[0];
      const adminRoleId = adminRow?.id ? Number(adminRow.id) : null;

      const nextType = (adminRoleId && validRoleIds.includes(adminRoleId)) ? 'A' : 'U';

      // bcrypt 有效上限 72，你的 SECURITY_CONFIG.PWD_MAX 已設 72，這裡再保險一次
      const safePwd = password.slice(0, SECURITY_CONFIG.PWD_MAX);
      const hash = await bcrypt.hash(safePwd, 12);

      let newUserId = null;

      await mySqlDb.withTransaction(async (tx) => {
        // account unique check（交易內避免 race）
        const ex = await tx.query(`SELECT id FROM custaccount WHERE account=? LIMIT 1`, [account]);
        const exList = (Array.isArray(ex) && Array.isArray(ex[0])) ? ex[0] : ex;
        if (exList?.length) {
          const err = new Error('ACCOUNT_EXISTS');
          err.code = 'ACCOUNT_EXISTS';
          throw err;
        }

        const ins = await tx.query(
          `INSERT INTO custaccount
           (account, password, type, name, cellphone, email, birthday, remark, is_disabled, create_date, update_date)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
          [account, hash, nextType, name || '', cellphone, email]
        );

        newUserId = ins?.insertId || ins?.[0]?.insertId;

        // 寫入 user_roles（若你 DB 有 unique(user_id, role_id)，可改 INSERT IGNORE 更耐打）
        for (const rid of validRoleIds) {
          await tx.query(
          `INSERT IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)`,
           [newUserId, rid]
        );
        //   await tx.query(`INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`, [newUserId, rid]);
        }

        await writeAuditLogTx(tx, req, {
          action: 'USER_CREATE',
          targetUserId: newUserId,
          detail: { account, roleIds: validRoleIds, type: nextType }
        });
      });

      invalidateUserPermCache(newUserId);

      return res.status(200).json({
        status: 'success',
        message: 'user created',
        id: newUserId,
        account,
        type: nextType,
        roleIds: validRoleIds
      });

    } catch (e) {
      // Terminal 顯示
      console.error('[API][USER_CREATE] error:', {
        msg: e?.message,
        code: e?.code,
        errno: e?.errno,
        sqlState: e?.sqlState,
        sqlMessage: e?.sqlMessage,
        sql: e?.sql
      });

      // 網頁顯示
      if (e?.code === 'ACCOUNT_EXISTS') {
        return res.status(409).json({ message: 'account already exists', code: 'ACCOUNT_EXISTS' });
      }

      return res.status(500).json({
        message: 'create failed',
        code: e?.code || 'SERVER_ERROR'
      });
    }
  }
);

// // ✅ (1) 新增人員：長度保護 + roleIds 驗證存在 + 審計 + 依 ADMIN 角色同步 type
// router.post('/admin/users',
//   requireAuthAuto,
//   requirePermission('user:manage'),
//   async (req, res) => {
//     try {
//       const body = req.body || {};

//       const account = normalizeAccount(body.account);          // 你 security.js 會限制長度
//       const email = normalizeEmail(body.email);
//       const name = String(body.name ?? '').trim().slice(0, 50);
//       const cellphone = String(body.cellphone ?? '').trim().slice(0, 15);
//       const password = String(body.password || '');

//       if (!account || !password) return res.status(400).json({ message: 'account/password required' });
//       if (!isValidAccount(account)) return res.status(400).json({ message: 'account 格式不正確（例：staff01 / admin.test）' });
//       if (!isValidEmail(email)) return res.status(400).json({ message: 'email 格式不正確' });

//       const pwdErr = passwordPolicyCheck(password, account);
//       if (pwdErr) return res.status(400).json({ message: pwdErr });

//       // roleIds：轉型 + 去重 + 限制數量（避免濫用）
//       const rawRoleIds = Array.isArray(body.roleIds) ? body.roleIds.map(Number).filter(Number.isFinite) : [];
//       const roleIds = Array.from(new Set(rawRoleIds)).slice(0, 50);

//       // 驗證 roles 存在
//       let validRoleIds = [];
//       if (roleIds.length) {
//         const rows = await mySqlDb.query(`SELECT id FROM roles WHERE id IN (?)`, [roleIds]);
//         const list = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0] : rows;
//         validRoleIds = (list || []).map(r => Number(r.id)).filter(Number.isFinite);
//       }

//       // admin role id（以 code 判斷）
//       const adminRows = await mySqlDb.query(`SELECT id FROM roles WHERE LOWER(code)='admin' LIMIT 1`);
//       const adminRow = (Array.isArray(adminRows) && Array.isArray(adminRows[0])) ? adminRows[0][0] : adminRows[0];
//       const adminRoleId = adminRow?.id ? Number(adminRow.id) : null;

//       const nextType = (adminRoleId && validRoleIds.includes(adminRoleId)) ? 'A' : 'U';

//       // bcrypt 有效上限 72，你的 SECURITY_CONFIG.PWD_MAX 已設 72，這裡再保險一次
//       const safePwd = password.slice(0, SECURITY_CONFIG.PWD_MAX);
//       const hash = await bcrypt.hash(safePwd, 12);

//       let newUserId = null;

//       await mySqlDb.withTransaction(async (tx) => {
//         // account unique check（交易內避免 race）
//         const ex = await tx.query(`SELECT id FROM custaccount WHERE account=? LIMIT 1`, [account]);
//         const exList = (Array.isArray(ex) && Array.isArray(ex[0])) ? ex[0] : ex;
//         if (exList?.length) {
//           const err = new Error('ACCOUNT_EXISTS');
//           err.code = 'ACCOUNT_EXISTS';
//           throw err;
//         }

//         const ins = await tx.query(
//           `INSERT INTO custaccount
//            (account, password, type, name, cellphone, email, birthday, remark, is_disabled, create_date, update_date)
//            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
//           [account, hash, nextType, name || '', cellphone || '', email || '']
//         );

//         newUserId = ins.insertId || ins?.[0]?.insertId;

//         for (const rid of validRoleIds) {
//           await tx.query(`INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`, [newUserId, rid]);
//         }

//         await writeAuditLogTx(tx, req, {
//           action: 'USER_CREATE',
//           targetUserId: newUserId,
//           detail: { account, roleIds: validRoleIds, type: nextType }
//         });
//       });

//       invalidateUserPermCache(newUserId);

//       return res.status(200).json({
//         status: 'success',
//         id: newUserId,
//         account,
//         type: nextType,
//         roleIds: validRoleIds
//       });

//     } catch (e) {
//       if (e?.code === 'ACCOUNT_EXISTS') return res.status(409).json({ message: 'account already exists' });
//       console.error('create user error:', e);
//       return res.status(500).json({ message: 'create failed' });
//     }
//   }
// );

// // B) 新增人員 API：新增完角色後，同步 type = A/U（整段只加必要區塊）
// // 你目前的新增人員 API，我建議改成下面這種「交易內同步」：
// router.post('/admin/users', requireAuthAuto, requirePermission('user:manage'), async (req, res) => {
//   const { account, password, name, cellphone, email, roleIds } = req.body || {};
//   if (!account || !password) return res.status(400).json({ message: 'account/password required' });

//   const exists = await mySqlDb.query(`SELECT id FROM custaccount WHERE account=? LIMIT 1`, [account]);
//   const existsRows = Array.isArray(exists) && Array.isArray(exists[0]) ? exists[0] : exists;
//   if (existsRows.length) return res.status(409).json({ message: 'account already exists' });

//   const hash = await bcrypt.hash(password, 12);
//   const roles = Array.isArray(roleIds) ? roleIds.map(Number).filter(Number.isFinite) : [];

//   let uid = null;

//   await mySqlDb.withTransaction(async (tx) => {
//     const ins = await tx.query(
//       `INSERT INTO custaccount (account, password, type, name, cellphone, email, birthday, remark, is_disabled)
//        VALUES (?, ?, 'U', ?, ?, ?, NULL, NULL, 0)`,
//       [account, hash, name || '', cellphone || '', email || '']
//     );

//     uid = ins.insertId || ins?.[0]?.insertId;

//     for (const rid of roles) {
//       await tx.query(`INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`, [uid, rid]);
//     }

//     // ✅ 1) 同步 type：如果勾到 ADMIN 角色 → type='A'
//     // 這裡用 roles.code 判斷，你把 ADMIN / SYS_ADMIN 改成你實際 roles.code
//     const chk = await tx.query(
//       `SELECT COUNT(*) AS c
//        FROM user_roles ur
//        JOIN roles r ON r.id = ur.role_id
//        WHERE ur.user_id=? AND r.code IN ('ADMIN','SYS_ADMIN')`,
//       [uid]
//     );
//     const c = chk?.[0]?.c ?? chk?.[0]?.[0]?.c ?? chk?.c ?? 0;
//     const nextType = Number(c) > 0 ? 'A' : 'U';
//     await tx.query(`UPDATE custaccount SET type=?, update_date=NOW() WHERE id=?`, [nextType, uid]);

//     // ✅ 2) 寫 audit（你目前用 writeAuditLogTx，但你沒貼實作）
//     // 先用你先前補的 writeAuditLog（或你自己已完成的 writeAuditLogTx）
//     if (typeof writeAuditLogTx === 'function') {
//       await writeAuditLogTx(tx, req, {
//         action: 'USER_CREATE',
//         targetUserId: uid,
//         detail: { account, roleIds: roles, nextType }
//       });
//     } else if (typeof writeAuditLog === 'function') {
//       await writeAuditLog(req, {
//         action: 'USER_CREATE',
//         targetUserId: uid,
//         detail: { account, roleIds: roles, nextType }
//       }, tx);
//     }
//   });

//   // ✅ 清快取：讓新帳號下次登入立刻拿到新 perms
//   // （新帳號通常還沒快取，但保險）
//   invalidateUserPermCache(uid);

//   return res.status(200).json({ status: 'success', id: uid });
// });

/**
 * ✅ (2) 管理員重設密碼：強密碼 + 不可重複 + revoke refresh + 審計
 * POST /api/admin/users/:id/resetPassword
 */
router.post(
  '/admin/users/:id/resetPassword',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    const targetUserId = Number(req.params.id);
    if (!Number.isFinite(targetUserId)) return res.status(400).json({ message: 'invalid id' });

    try {
      const newPassword = String(req.body?.newPassword || '');
      if (!newPassword) return res.status(400).json({ message: 'newPassword required' });

      const rows = await mySqlDb.query(
        `SELECT id, account, password FROM custaccount WHERE id=? LIMIT 1`,
        [targetUserId]
      );
      const u = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!u) return res.status(404).json({ message: 'user not found' });

      const pwdErr = passwordPolicyCheck(newPassword, u.account);
      if (pwdErr) return res.status(400).json({ message: pwdErr });

      const safePwd = newPassword.slice(0, SECURITY_CONFIG.PWD_MAX);

      // 不可與舊密碼相同
      const same = await bcrypt.compare(safePwd, u.password);
      if (same) return res.status(400).json({ message: '新密碼不可與舊密碼相同' });

      const hash = await bcrypt.hash(safePwd, 12);

      await mySqlDb.withTransaction(async (tx) => {
        const upd = await tx.query(
          `UPDATE custaccount
           SET password=?,
               password_reset_at=NOW(),
               password_reset_by=?,
               update_date=CURRENT_TIMESTAMP()
           WHERE id=?`,
          [hash, req.user.id, targetUserId]
        );

        const affected = upd?.affectedRows ?? upd?.[0]?.affectedRows ?? 0;
        if (!affected) {
          const err = new Error('NOT_FOUND');
          err.code = 'NOT_FOUND';
          throw err;
        }

        // ✅ revoke refresh：逼所有裝置重新登入
        await tx.query(
          `UPDATE auth_refresh_tokens
           SET revoked_at=NOW()
           WHERE user_id=? AND revoked_at IS NULL`,
          [targetUserId]
        );

        await writeAuditLogTx(tx, req, {
          action: 'USER_RESET_PASSWORD',
          targetUserId,
          detail: { by: req.user?.account || req.user?.id }
        });
      });

      invalidateUserPermCache(targetUserId);
      return res.status(200).json({ status: 'success', message: 'password reset ok' });

    } catch (e) {
      console.error('[API][USER_RESET_PASSWORD] error:', {
        msg: e?.message,
        code: e?.code,
        errno: e?.errno,
        sqlState: e?.sqlState,
        sqlMessage: e?.sqlMessage,
        sql: e?.sql
      });

      if (e?.code === 'NOT_FOUND') return res.status(404).json({ message: 'user not found', code: 'NOT_FOUND' });

      return res.status(500).json({
        message: 'reset failed',
        code: e?.code || 'SERVER_ERROR'
      });
    }
  }
);
// // 2) 重設密碼（含審計欄位 + 寫 log + 404 + 避免弱密碼）
// router.post('/admin/users/:id/resetPassword',
//   requireAuthAuto,
//   requirePermission('user:manage'),
//   async (req, res) => {
//     const targetUserId = Number(req.params.id);
//     if (!Number.isFinite(targetUserId)) return res.status(400).json({ message: 'invalid id' });

//     const { newPassword } = req.body || {};
//     const pwd = String(newPassword || '');

//     // ✅ 最低要求（你可再加：需含大小寫/數字/符號）
//     if (pwd.length < 8) return res.status(400).json({ message: 'newPassword must be at least 8 chars' });

//     try {
//       const hash = await bcrypt.hash(pwd, 12);

//       await mySqlDb.withTransaction(async (tx) => {
//         const upd = await tx.query(
//           `UPDATE custaccount
//            SET password=?,
//                password_reset_at=NOW(),
//                password_reset_by=?,
//                update_date=NOW()
//            WHERE id=?`,
//           [hash, req.user.id, targetUserId]
//         );

//         if (!upd.affectedRows) {
//           throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
//         }

//         await writeAuditLog(req, {
//           action: 'USER_RESET_PASSWORD',
//           targetUserId,
//           detail: { by: req.user.account }
//         }, tx);
//       });

//       // ✅ 可選：如果你希望「重設密碼後，該使用者所有裝置都要重新登入」
//       // await mySqlDb.query(`UPDATE auth_refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL`, [targetUserId]);

//       return res.status(200).json({ status: 'success' });
//     } catch (e) {
//       if (e?.code === 'NOT_FOUND' || e.message === 'NOT_FOUND') {
//         return res.status(404).json({ message: 'user not found' });
//       }
//       console.error('reset password error:', e);
//       return res.status(500).json({ message: 'reset failed' });
//     }
//   }
// );

/**
 * ✅ (3) 使用者自行改密碼：驗舊密碼 + 強密碼 + 不可重複 + revoke refresh + 審計 + 清 cookie
 * POST /api/me/changePassword
 */
router.post(
  '/me/changePassword',
  requireAuthAuto,
  async (req, res) => {
    try {
      const oldPassword = String(req.body?.oldPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: 'oldPassword/newPassword required' });
      }

      const userId = req.user.id;

      const rows = await mySqlDb.query(
        `SELECT id, account, password FROM custaccount WHERE id=? LIMIT 1`,
        [userId]
      );
      const u = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!u) return res.status(401).json({ message: 'Not logged in' });

      const oldSafe = oldPassword.slice(0, SECURITY_CONFIG.PWD_MAX);
      const ok = await bcrypt.compare(oldSafe, u.password);
      if (!ok) return res.status(400).json({ message: '舊密碼不正確' });

      const pwdErr = passwordPolicyCheck(newPassword, u.account);
      if (pwdErr) return res.status(400).json({ message: pwdErr });

      const newSafe = newPassword.slice(0, SECURITY_CONFIG.PWD_MAX);

      // 不可重複
      const same = await bcrypt.compare(newSafe, u.password);
      if (same) return res.status(400).json({ message: '新密碼不可與舊密碼相同' });

      const hash = await bcrypt.hash(newSafe, 12);

      await mySqlDb.withTransaction(async (tx) => {
        await tx.query(
          `UPDATE custaccount
           SET password=?,
               update_date=CURRENT_TIMESTAMP()
           WHERE id=?`,
          [hash, userId]
        );

        // ✅ revoke refresh（包含自己這台）
        await tx.query(
          `UPDATE auth_refresh_tokens
           SET revoked_at=NOW()
           WHERE user_id=? AND revoked_at IS NULL`,
          [userId]
        );

        await writeAuditLogTx(tx, req, {
          action: 'USER_CHANGE_PASSWORD',
          targetUserId: userId,
          detail: { self: true }
        });
      });

      invalidateUserPermCache(userId);

      // ✅ 改密碼後安全做法：清 cookie -> 需要重新登入
      const common = {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true'
      };
      res.clearCookie('access_token', common);
      res.clearCookie('refresh_token', { ...common, path: '/api/refresh' });

      return res.status(200).json({
        status: 'success',
        message: 'password changed, please login again'
      });

    } catch (e) {
      console.error('[API][ME_CHANGE_PASSWORD] error:', {
        msg: e?.message,
        code: e?.code,
        errno: e?.errno,
        sqlState: e?.sqlState,
        sqlMessage: e?.sqlMessage,
        sql: e?.sql
      });

      return res.status(500).json({
        message: 'change password failed',
        code: e?.code || 'SERVER_ERROR'
      });
    }
  }
);

// 1) 停用/啟用（含審計欄位 + revoke refresh + 寫 log + 保護自己 + 404）
router.patch('/admin/users/:id/disable',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    const targetUserId = Number(req.params.id);
    if (!Number.isFinite(targetUserId)) return res.status(400).json({ message: 'invalid id' });

    const { disabled, reason } = req.body || {};
    const isDisabled = disabled ? 1 : 0;
    const safeReason = String(reason || '').slice(0, 255);

    // ✅ 避免停用自己（可選但強烈建議）
    if (targetUserId === req.user.id && isDisabled === 1) {
      return res.status(400).json({ message: 'cannot disable yourself' });
    }

    try {
      await mySqlDb.withTransaction(async (tx) => {
        const upd = await tx.query(
          `UPDATE custaccount
           SET is_disabled=?,
               disabled_at = CASE WHEN ?=1 THEN NOW() ELSE NULL END,
               disabled_by = CASE WHEN ?=1 THEN ? ELSE NULL END,
               disabled_reason = CASE WHEN ?=1 THEN ? ELSE NULL END,
               update_date=NOW()
           WHERE id=?`,
          [isDisabled, isDisabled, isDisabled, req.user.id, isDisabled, safeReason, targetUserId]
        );

        if (!upd.affectedRows) {
          // ✅ 不存在
          throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        }

        // ✅ 停用時撤銷 refresh（讓 refresh 也失效）
        if (isDisabled === 1) {
          await tx.query(
            `UPDATE auth_refresh_tokens SET revoked_at = NOW()
             WHERE user_id=? AND revoked_at IS NULL`,
            [targetUserId]
          );
        }

        // ✅ 寫 audit log（同 transaction）
        await writeAuditLog(req, {
          action: isDisabled ? 'USER_DISABLE' : 'USER_ENABLE',
          targetUserId,
          detail: { reason: safeReason }
        }, tx);
      });

      // ✅ perms 快取失效（避免權限/狀態更新後仍沿用舊快取）
      invalidateUserPermCache(targetUserId);

      return res.status(200).json({ status: 'success' });
    } catch (e) {
      if (e?.code === 'NOT_FOUND' || e.message === 'NOT_FOUND') {
        return res.status(404).json({ message: 'user not found' });
      }
      console.error('disable user error:', e);
      return res.status(500).json({ message: 'disable failed' });
    }
  }
);


//chatgpt
// B-5) 新增「裝置列表」API（管理頁可用）
//GET /api/sessions：列出目前帳號的登入裝置
router.get('/sessions', requireAuthAuto, async (req, res) => {
  const rows = await mySqlDb.query(
    `SELECT device_id,
            MAX(created_at) AS first_login_at,
            MAX(last_used_at) AS last_used_at,
            MAX(user_agent) AS user_agent,
            MAX(ip) AS ip,
            SUM(CASE WHEN revoked_at IS NULL AND expires_at > NOW() THEN 1 ELSE 0 END) AS active_tokens
     FROM auth_refresh_tokens
     WHERE user_id = ?
     GROUP BY device_id
     ORDER BY last_used_at DESC`,
    [req.user.id]
  );

  res.status(200).json({ sessions: rows });
});

//POST /api/sessions/revoke：登出「某一裝置」
router.post('/sessions/revoke', requireAuthAuto, async (req, res) => {
  const { device_id } = req.body || {};
  if (!device_id) return res.status(400).json({ message: 'device_id required' });

  await mySqlDb.query(
    "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL",
    [req.user.id, device_id]
  );

  // 若剛好是目前裝置，也順便清 cookie
  if (req.cookies?.device_id === device_id) {
    res.clearCookie('access_token', cookieCommon());
    res.clearCookie('refresh_token', { ...cookieCommon(), path: '/api/refresh' });
  }

  res.status(200).json({ status: 'success' });
});

//POST /api/sessions/revokeAll：登出全部裝置
router.post('/sessions/revokeAll', requireAuthAuto, async (req, res) => {
  await mySqlDb.query(
    "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
    [req.user.id]
  );

  res.clearCookie('access_token', cookieCommon());
  res.clearCookie('refresh_token', { ...cookieCommon(), path: '/api/refresh' });

  res.status(200).json({ status: 'success' });
});

// 1-4 金流回調（Paid / Failed）＋回補機制（補償）
// 你需要兩條後端端點：
// POST /api/payment/ecpay/notify：綠界 server-to-server 回呼（最可信）
// GET /payment/result：使用者導回頁（只做顯示，不作為最終依據）
// 1-4-1 付款成功回調：把訂單改 PAID（且不回補）
// 重點：只允許 PENDING → PAID 一次（避免重放攻擊）
router.post('/payment/ecpay/notify', async (req, res) => {
  try {
    // 1) 驗證簽章/CheckMacValue（務必依綠界官方文件）
    // 2) 取 trade_no（MerchantTradeNo）
    const tradeNo = req.body?.MerchantTradeNo;
    const rtnCode = String(req.body?.RtnCode || '');

    if (!tradeNo) return res.status(400).send('0|Missing tradeNo');

    // 付款成功判斷（綠界常見成功碼是 1，但你務必以文件為準）
    const paidOk = rtnCode === '1';

    if (paidOk) {
      await mySqlDb.withTransaction(async (tx) => {
        const rows = await tx.query(
          `SELECT id, status2, expires_at FROM shop_order WHERE trade_no = ? FOR UPDATE`,
          [tradeNo]
        );
        if (!rows || rows.length === 0) throw new Error('Order not found');

        const o = rows[0];
        if (o.status2 === 'PAID') return; // idempotent
        if (o.status2 !== 'PENDING') throw new Error(`Invalid status: ${o.status2}`);

        await tx.query(
          `UPDATE shop_order SET status2='PAID', paid_at=NOW() WHERE id=?`,
          [o.id]
        );
      });

      // 綠界回覆格式通常是 "1|OK"
      return res.status(200).send('1|OK');
    }

    // 付款失敗：可立即取消並回補（或留給到期 job 回補）
    // 建議立即回補比較好（使用者付款失敗就釋放）
    await cancelAndRestockByTradeNo(tradeNo, 'CANCELLED');
    return res.status(200).send('1|OK');

  } catch (err) {
    console.error('ecpay notify error:', err);
    // 綠界可能要求固定格式，避免一直重送
    return res.status(200).send('0|FAIL');
  }
});

// 回補函式：PENDING -> CANCELLED/EXPIRED，並回補 reserved_qty（只回補一次）
async function cancelAndRestockByTradeNo(tradeNo, newStatus) {
  return mySqlDb.withTransaction(async (tx) => {
    const orders = await tx.query(
      `SELECT id, status2 FROM shop_order WHERE trade_no=? FOR UPDATE`,
      [tradeNo]
    );
    if (!orders || orders.length === 0) return;

    const order = orders[0];
    if (order.status2 === 'PAID') return;        // 已付款不可回補
    if (order.status2 !== 'PENDING') return;     // 已取消/過期也不重複做

    const items = await tx.query(
      `SELECT product_id, reserved_qty, released_at FROM shop_order_item WHERE order_id=? FOR UPDATE`,
      [order.id]
    );

    // 回補庫存（只回補未 released 的）
    for (const it of items) {
      if (it.released_at) continue;
      await tx.query(`UPDATE product SET inventory = inventory + ? WHERE id=?`, [it.reserved_qty, it.product_id]);
      await tx.query(`UPDATE shop_order_item SET released_at=NOW() WHERE order_id=? AND product_id=?`, [order.id, it.product_id]);
    }

    await tx.query(`UPDATE shop_order SET status2=? WHERE id=?`, [newStatus, order.id]);
  });
}


/* =========================
 * 其他工具（保留）
 * ========================= */
function _uuid() {
  let d = Date.now();
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    d += performance.now();
  }
  return 'xxxxxxxxxxxx4xxxyxxx'.replace(/[xy]/g, function (c) {
    let r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function _dateString() {
  const date = new Date();
  return (
    date.getFullYear() +
    '/' +
    ('00' + (date.getMonth() + 1)).slice(-2) +
    '/' +
    ('00' + date.getDate()).slice(-2) +
    ' ' +
    ('00' + date.getHours()).slice(-2) +
    ':' +
    ('00' + date.getMinutes()).slice(-2) +
    ':' +
    ('00' + date.getSeconds()).slice(-2)
  );
}

// 20260201--------------------------
// 3) API 設計（建議 3 支）
// A. 取得自己的資料
// GET /api/me/profile
// B. 自己更新自己的資料（需登入）
// PATCH /api/me/profile
// C. 管理員更新指定使用者資料（需 user:manage）
// PATCH /api/admin/users/:id/profile
// 三支都要：
// 用你現有 utils/security.js 的 normalize/regex/長度限制
// 寫 audit log（你現有 utils/audit.js）
// console 錯誤照樣印（terminal 看得到）+ 回傳 message（前端顯示）

// 4) 後端完整可貼版本（直接塞進 apis/api.js）
// 我假設你已經有：requireAuthAuto、requirePermission、mySqlDb、writeAuditLogTx
// 並且 security.js 有：normalizeEmail、isValidEmail、SECURITY_CONFIG、（你現在 email/cellphone 必填由業務邏輯擋）

// 5) 前端怎麼做（你目前有兩個方向）
// A) 給使用者一個「我的資料」頁（推薦）
// 新增 profile.ejs：
// 顯示 name/cellphone/email
// PATCH /api/me/profile
// 錯誤顯示用你現在的 apiRequest + msgBox 模式即可
// B) 在你現有 admin_users.ejs 的「詳情 modal」加「編輯」按鈕（管理員代改）
// 你現在 detailModal 已有 user 詳情，做法是：
// 在 detailModal 內加 input（name/cellphone/email）
// 加「儲存」按鈕 → PATCH /api/admin/users/:id/profile
// 成功訊息顯示在 detailModal 內（照你現在 modal alert 模式）

// 6) 企業常見加強（可選但很實用）
// 需要驗證 Email / 手機（發驗證碼）再允許變更（避免帳號被改成別人的）
// 若你有 SSO/員工系統，管理員更新要更嚴格審計（你已經有 audit，很加分）
// 對「自己改 Email」：常見策略是先寫到 pending_email，驗證後才切換

// 下面我直接給你**「可覆蓋貼上」**的完整版本（含 A 我的資料頁 profile.ejs + B admin 詳情 modal 內直接可改），以及對應的 API routes（貼進 apis/api.js）、頁面 route（貼進 pages.js 或你的 page router）。

// ✅ 前提假設（跟你現況一致）
// 你已經有 requireAuthAuto、requirePermission()
// 你已經有 mySqlDb.withTransaction()、writeAuditLogTx()
// 你已經有 utils/security.js：normalizeEmail、isValidEmail、SECURITY_CONFIG
// 你已經有 /api/security/config（你前面已做好）
// 你目前 admin_users.ejs 已經有 apiRequest / msgBox / modal msgBox 那套
// 一、後端 API：直接貼進 apis/api.js（可覆蓋同名路由）
// 如果你已經有其中某些路由，請以我這份為準覆蓋同一段（避免重複註冊）

// // ===== 個人資料：取得自己 =====
// router.get('/me/profile',
//   requireAuthAuto,
//   async (req, res) => {
//     try {
//       const userId = req.user.id;

//       const rows = await mySqlDb.query(
//         `SELECT id, account, type, name, cellphone, email, create_date, update_date
//          FROM custaccount
//          WHERE id=? LIMIT 1`,
//         [userId]
//       );

//       const u = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
//       if (!u) return res.status(401).json({ message: 'Not logged in' });

//       return res.status(200).json({ user: u });
//     } catch (e) {
//       console.error('get me profile error:', e);
//       return res.status(500).json({ message: 'get profile failed' });
//     }
//   }
// );


// // ===== 個人資料：取得自己 =====
// router.get('/me/profile',
//   requireAuthAuto,
//   async (req, res) => {
//     try {
//       const userId = req.user.id;

//       const rows = await mySqlDb.query(
//         `SELECT id, account, type, name, cellphone, email, create_date, update_date
//          FROM custaccount
//          WHERE id=? LIMIT 1`,
//         [userId]
//       );

//       const u = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
//       if (!u) return res.status(401).json({ message: 'Not logged in' });

//       return res.status(200).json({ user: u });
//     } catch (e) {
//       console.error('get me profile error:', e);
//       return res.status(500).json({ message: 'get profile failed' });
//     }
//   }
// );


// // ===== 個人資料：自己更新 =====
// router.patch('/me/profile',
//   requireAuthAuto,
//   async (req, res) => {
//     try {
//       const userId = req.user.id;
//       const body = req.body || {};

//       const name = String(body.name ?? '').trim().slice(0, 50);
//       const cellphone = String(body.cellphone ?? '').trim().slice(0, 15);
//       const email = normalizeEmail(body.email);

//       // ✅ 你要求：email/cellphone 必填
//       if (!cellphone) return res.status(400).json({ message: '手機為必填' });
//       if (!email) return res.status(400).json({ message: 'Email 為必填' });
//       if (!isValidEmail(email)) return res.status(400).json({ message: 'email 格式不正確' });

//       // 讀舊資料（審計）
//       const rows = await mySqlDb.query(
//         `SELECT id, account, name, cellphone, email
//          FROM custaccount WHERE id=? LIMIT 1`,
//         [userId]
//       );
//       const oldU = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
//       if (!oldU) return res.status(401).json({ message: 'Not logged in' });

//       await mySqlDb.withTransaction(async (tx) => {
//         // ✅ 唯一性檢查（DB 若已加 UNIQUE，這段仍可保留以回傳更友善訊息）
//         const e1 = await tx.query(
//           `SELECT id FROM custaccount WHERE email=? AND id<>? LIMIT 1`,
//           [email, userId]
//         );
//         const e1List = (Array.isArray(e1) && Array.isArray(e1[0])) ? e1[0] : e1;
//         if (e1List?.length) {
//           const err = new Error('EMAIL_EXISTS');
//           err.code = 'EMAIL_EXISTS';
//           throw err;
//         }

//         const c1 = await tx.query(
//           `SELECT id FROM custaccount WHERE cellphone=? AND id<>? LIMIT 1`,
//           [cellphone, userId]
//         );
//         const c1List = (Array.isArray(c1) && Array.isArray(c1[0])) ? c1[0] : c1;
//         if (c1List?.length) {
//           const err = new Error('CELLPHONE_EXISTS');
//           err.code = 'CELLPHONE_EXISTS';
//           throw err;
//         }

//         await tx.query(
//           `UPDATE custaccount
//            SET name=?,
//                cellphone=?,
//                email=?,
//                update_date=CURRENT_TIMESTAMP()
//            WHERE id=?`,
//           [name, cellphone, email, userId]
//         );

//         await writeAuditLogTx(tx, req, {
//           action: 'USER_UPDATE_PROFILE',
//           targetUserId: userId,
//           detail: {
//             self: true,
//             before: { name: oldU.name, cellphone: oldU.cellphone, email: oldU.email },
//             after: { name, cellphone, email }
//           }
//         });
//       });

//       return res.status(200).json({ status: 'success' });

//     } catch (e) {
//       if (e?.code === 'EMAIL_EXISTS') return res.status(409).json({ message: 'Email 已被使用' });
//       if (e?.code === 'CELLPHONE_EXISTS') return res.status(409).json({ message: '手機已被使用' });
//       if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email 或手機已被使用' });

//       console.error('update me profile error:', e);
//       return res.status(500).json({ message: 'update profile failed' });
//     }
//   }
// );


// ===== 管理員：更新指定使用者資料（admin 詳情 modal 會用到）=====
router.patch('/admin/users/:id/profile',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    const targetUserId = Number(req.params.id);
    if (!Number.isFinite(targetUserId)) return res.status(400).json({ message: 'invalid id' });

    try {
      const body = req.body || {};

      const name = String(body.name ?? '').trim().slice(0, 50);
      const cellphone = String(body.cellphone ?? '').trim().slice(0, 15);
      const email = normalizeEmail(body.email);

      // ✅ 你要求：email/cellphone 必填
      if (!cellphone) return res.status(400).json({ message: '手機為必填' });
      if (!email) return res.status(400).json({ message: 'Email 為必填' });
      if (!isValidEmail(email)) return res.status(400).json({ message: 'email 格式不正確' });

      const rows = await mySqlDb.query(
        `SELECT id, account, name, cellphone, email
         FROM custaccount WHERE id=? LIMIT 1`,
        [targetUserId]
      );
      const oldU = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!oldU) return res.status(404).json({ message: 'user not found' });

      await mySqlDb.withTransaction(async (tx) => {
        const e1 = await tx.query(
          `SELECT id FROM custaccount WHERE email=? AND id<>? LIMIT 1`,
          [email, targetUserId]
        );
        const e1List = (Array.isArray(e1) && Array.isArray(e1[0])) ? e1[0] : e1;
        if (e1List?.length) {
          const err = new Error('EMAIL_EXISTS');
          err.code = 'EMAIL_EXISTS';
          throw err;
        }

        const c1 = await tx.query(
          `SELECT id FROM custaccount WHERE cellphone=? AND id<>? LIMIT 1`,
          [cellphone, targetUserId]
        );
        const c1List = (Array.isArray(c1) && Array.isArray(c1[0])) ? c1[0] : c1;
        if (c1List?.length) {
          const err = new Error('CELLPHONE_EXISTS');
          err.code = 'CELLPHONE_EXISTS';
          throw err;
        }

        await tx.query(
          `UPDATE custaccount
           SET name=?,
               cellphone=?,
               email=?,
               update_date=CURRENT_TIMESTAMP()
           WHERE id=?`,
          [name, cellphone, email, targetUserId]
        );

        await writeAuditLogTx(tx, req, {
          action: 'ADMIN_UPDATE_USER_PROFILE',
          targetUserId,
          detail: {
            by: req.user?.account || req.user?.id,
            before: { name: oldU.name, cellphone: oldU.cellphone, email: oldU.email },
            after: { name, cellphone, email }
          }
        });
      });

      return res.status(200).json({ status: 'success' });

    } catch (e) {
      if (e?.code === 'EMAIL_EXISTS') return res.status(409).json({ message: 'Email 已被使用' });
      if (e?.code === 'CELLPHONE_EXISTS') return res.status(409).json({ message: '手機已被使用' });
      if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email 或手機已被使用' });

      console.error('admin update profile error:', e);
      return res.status(500).json({ message: 'update failed' });
    }
  }
);



// ===== 個人資料：取得自己（含是否有 pending email）=====
router.get('/me/profile',
  requireAuthAuto,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const rows = await mySqlDb.query(
        `SELECT id, account, type, name, cellphone, email, create_date, update_date
         FROM custaccount
         WHERE id=? LIMIT 1`,
        [userId]
      );
      const u = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!u) return res.status(401).json({ message: 'Not logged in' });

      // 2) ✅ 後端補「resend 驗證信 API」：POST /api/me/email/resend
      // 2-1) 先調整 GET /api/me/profile 讓它回 pending 的更多資訊（可顯示倒數 / 重寄按鈕）
      // 把你原本 GET /me/profile 查 pending 的 SQL 改成回 id, new_email, expires_at, created_at：
      // GET /api/me/profile 取 pending：改成回更多欄位
      const pRows = await mySqlDb.query(
        `SELECT id, new_email, expires_at, created_at
        FROM user_email_verifications
        WHERE user_id=? AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
        [userId]
      );
      const p = (Array.isArray(pRows) && Array.isArray(pRows[0])) ? pRows[0][0] : pRows[0];

      return res.status(200).json({
        user: u,
        pendingEmail: p ? {
          id: Number(p.id),
          email: p.new_email,
          expires_at: p.expires_at,
          created_at: p.created_at
        } : null
      });

      // // 取最新一筆尚未使用且未過期的 pending
      // const pRows = await mySqlDb.query(
      //   `SELECT new_email, expires_at
      //    FROM user_email_verifications
      //    WHERE user_id=? AND used_at IS NULL AND expires_at > NOW()
      //    ORDER BY created_at DESC
      //    LIMIT 1`,
      //   [userId]
      // );
      // const p = (Array.isArray(pRows) && Array.isArray(pRows[0])) ? pRows[0][0] : pRows[0];

      // return res.status(200).json({
      //   user: u,
      //   pendingEmail: p ? { email: p.new_email, expires_at: p.expires_at } : null
      // });
    } catch (e) {
      console.error('get me profile error:', e);
      return res.status(500).json({ message: 'get profile failed' });
    }
  }
);


// ===== 個人資料：自己更新（姓名/手機可直接改；Email 改動改走寄驗證信）=====
router.patch('/me/profile',
  requireAuthAuto,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const body = req.body || {};

      const name = clampStr(body.name, 50);
      const cellphone = clampStr(body.cellphone, 15);
      const email = normalizeEmail(body.email);

      // ✅ 你要求：email/cellphone 必填
      if (!cellphone) return res.status(400).json({ message: '手機為必填' });
      if (!email) return res.status(400).json({ message: 'Email 為必填' });
      if (!isValidEmail(email)) return res.status(400).json({ message: 'email 格式不正確' });

      // 讀舊資料（審計 + 判斷 email 是否有變）
      const rows = await mySqlDb.query(
        `SELECT id, account, name, cellphone, email
         FROM custaccount WHERE id=? LIMIT 1`,
        [userId]
      );
      const oldU = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!oldU) return res.status(401).json({ message: 'Not logged in' });

      const emailChanged = String(email).toLowerCase() !== String(oldU.email || '').toLowerCase();

      // ✅ 情況A：Email 沒變 → 直接更新 name/cellphone
      if (!emailChanged) {
        await mySqlDb.withTransaction(async (tx) => {
          // cellphone unique check（若你有做 unique）
          const c1 = await tx.query(
            `SELECT id FROM custaccount WHERE cellphone=? AND id<>? LIMIT 1`,
            [cellphone, userId]
          );
          const c1List = (Array.isArray(c1) && Array.isArray(c1[0])) ? c1[0] : c1;
          if (c1List?.length) {
            const err = new Error('CELLPHONE_EXISTS');
            err.code = 'CELLPHONE_EXISTS';
            throw err;
          }

          await tx.query(
            `UPDATE custaccount
             SET name=?,
                 cellphone=?,
                 update_date=CURRENT_TIMESTAMP()
             WHERE id=?`,
            [name, cellphone, userId]
          );

          await writeAuditLogTx(tx, req, {
            action: 'USER_UPDATE_PROFILE',
            targetUserId: userId,
            detail: {
              self: true,
              before: { name: oldU.name, cellphone: oldU.cellphone, email: oldU.email },
              after: { name, cellphone, email: oldU.email }
            }
          });
        });

        return res.status(200).json({ status: 'success', message: 'profile updated' });
      }

      // ✅ 情況B：Email 有變 → 更新 name/cellphone 仍可直接生效，但 email 改為「待驗證」
      // （企業常見做法：不阻擋姓名/手機更新）
      await mySqlDb.withTransaction(async (tx) => {
        // cellphone unique check
        const c1 = await tx.query(
          `SELECT id FROM custaccount WHERE cellphone=? AND id<>? LIMIT 1`,
          [cellphone, userId]
        );
        const c1List = (Array.isArray(c1) && Array.isArray(c1[0])) ? c1[0] : c1;
        if (c1List?.length) {
          const err = new Error('CELLPHONE_EXISTS');
          err.code = 'CELLPHONE_EXISTS';
          throw err;
        }

        // new email unique check（避免寄給已被使用的 email）
        const e1 = await tx.query(
          `SELECT id FROM custaccount WHERE email=? AND id<>? LIMIT 1`,
          [email, userId]
        );
        const e1List = (Array.isArray(e1) && Array.isArray(e1[0])) ? e1[0] : e1;
        if (e1List?.length) {
          const err = new Error('EMAIL_EXISTS');
          err.code = 'EMAIL_EXISTS';
          throw err;
        }

        // 更新 name/cellphone（email 不直接改）
        await tx.query(
          `UPDATE custaccount
           SET name=?,
               cellphone=?,
               update_date=CURRENT_TIMESTAMP()
           WHERE id=?`,
          [name, cellphone, userId]
        );

        // 建立驗證 token
        const token = crypto.randomBytes(32).toString('hex'); // 64 chars
        const tokenHash = sha256Hex(token);
        const expiresMinutes = Number(process.env.EMAIL_VERIFY_EXPIRE_MIN || 30);
        const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

        await tx.query(
          `INSERT INTO user_email_verifications
           (user_id, new_email, token_hash, expires_at, created_ip, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            userId,
            email,
            tokenHash,
            expiresAt,
            getClientIp(req),
            clampStr(req.headers['user-agent'], 255)
          ]
        );

        await writeAuditLogTx(tx, req, {
          action: 'USER_REQUEST_EMAIL_CHANGE',
          targetUserId: userId,
          detail: {
            self: true,
            before: { email: oldU.email },
            pending: { newEmail: email, expiresAt }
          }
        });

        // 寄信（交易內不寄，避免寄了但 DB rollback）
        // 我們把 token 暫存在 req 上，交易後寄
        req._emailChangeToken = token;
        req._emailChangeNewEmail = email;
        req._emailChangeExpiresMin = expiresMinutes;
      });

      // 交易成功後寄信
      const baseUrl = getBaseUrl(req);
      const token = req._emailChangeToken;
      const newEmail = req._emailChangeNewEmail;
      const expiresMin = req._emailChangeExpiresMin;

      const link = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
      try {
        await sendMail({
          to: newEmail,
          subject: 'TMC SHOP - Email 變更驗證',
          text: `請點擊以下連結完成 Email 變更驗證（${expiresMin} 分鐘內有效）：\n${link}`,
          html: `...`
        });
      } catch (mailErr) {
        console.error('[EMAIL SEND FAILED]', mailErr);
        // ❗不要 throw，避免整個 profile rollback
        return res.status(202).json({
          status: 'pending',
          message: '資料已更新，但驗證信寄送失敗，請稍後再嘗試重新寄送'
        });
      }

      return res.status(202).json({
        status: 'pending',
        message: '已寄出驗證信，請至新 Email 收信並完成驗證後才會生效'
      });

      // await sendMail({
      //   to: newEmail,
      //   subject: 'TMC SHOP - Email 變更驗證',
      //   text: `請點擊以下連結完成 Email 變更驗證（${expiresMin} 分鐘內有效）：\n${link}`,
      //   html: `
      //     <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
      //       <p>您好，</p>
      //       <p>您正在變更 TMC SHOP 帳號 Email，請點擊以下連結完成驗證（<b>${expiresMin}</b> 分鐘內有效）：</p>
      //       <p><a href="${link}">${link}</a></p>
      //       <p>若非本人操作，請忽略本信。</p>
      //     </div>
      //   `
      // });

      // return res.status(202).json({
      //   status: 'pending',
      //   message: '已寄出驗證信，請至新 Email 收信並完成驗證後才會生效'
      // });

    } catch (e) {
      if (e?.code === 'EMAIL_EXISTS') return res.status(409).json({ message: 'Email 已被使用' });
      if (e?.code === 'CELLPHONE_EXISTS') return res.status(409).json({ message: '手機已被使用' });
      if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email 或手機已被使用' });

      console.error('update me profile error:', e);
      return res.status(500).json({ message: 'update profile failed' });
    }
  }
);


// ===== Email 驗證：點連結後完成變更 =====
router.get('/me/email/verify',
  async (req, res) => {
    try {
      const token = String(req.query?.token || '');
      if (!token || token.length < 20) {
        return res.status(400).json({ message: 'invalid token' });
      }

      const tokenHash = sha256Hex(token);

      // 找 token
      const rows = await mySqlDb.query(
        `SELECT id, user_id, new_email, expires_at, used_at
         FROM user_email_verifications
         WHERE token_hash=? LIMIT 1`,
        [tokenHash]
      );
      const rec = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!rec) return res.status(400).json({ message: 'token not found' });
      if (rec.used_at) return res.status(400).json({ message: 'token already used' });

      // 過期
      const exp = new Date(rec.expires_at);
      if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
        return res.status(400).json({ message: 'token expired' });
      }

      await mySqlDb.withTransaction(async (tx) => {
        // 再次確認未使用（避免 race）
        const chk = await tx.query(
          `SELECT id, user_id, new_email, expires_at, used_at
           FROM user_email_verifications
           WHERE id=? FOR UPDATE`,
          [rec.id]
        );
        const c = (Array.isArray(chk) && Array.isArray(chk[0])) ? chk[0][0] : chk[0];
        if (!c || c.used_at) {
          const err = new Error('ALREADY_USED');
          err.code = 'ALREADY_USED';
          throw err;
        }

        // email 是否已被他人占用
        const e1 = await tx.query(
          `SELECT id FROM custaccount WHERE email=? AND id<>? LIMIT 1`,
          [c.new_email, c.user_id]
        );
        const e1List = (Array.isArray(e1) && Array.isArray(e1[0])) ? e1[0] : e1;
        if (e1List?.length) {
          const err = new Error('EMAIL_EXISTS');
          err.code = 'EMAIL_EXISTS';
          throw err;
        }

        // 更新 email
        await tx.query(
          `UPDATE custaccount
           SET email=?,
               update_date=CURRENT_TIMESTAMP()
           WHERE id=?`,
          [c.new_email, c.user_id]
        );

        // 標記 token 已使用
        await tx.query(
          `UPDATE user_email_verifications
           SET used_at=NOW()
           WHERE id=?`,
          [c.id]
        );

        // 審計
        await writeAuditLogTx(tx, req, {
          action: 'USER_VERIFY_EMAIL_CHANGE',
          targetUserId: c.user_id,
          detail: { newEmail: c.new_email }
        });
      });

      return res.status(200).json({ status: 'success', message: 'email verified' });

    } catch (e) {
      if (e?.code === 'EMAIL_EXISTS') return res.status(409).json({ message: 'Email 已被使用' });
      if (e?.code === 'ALREADY_USED') return res.status(400).json({ message: 'token already used' });

      console.error('verify email error:', e);
      return res.status(500).json({ message: 'verify failed' });
    }
  }
);


// 2-2) 新增 API：POST /api/me/email/resend
// 特色：
// 只會重寄「最新 pending」那筆
// 頻率限制（預設 60 秒內不重寄）
// SMTP 失敗 不 throw 500 卡死，會回 202 + message 讓前端顯示
// 成功回 200
// 把下面整段貼到 apis/api.js（在 verify route 附近）：
// ===== 重新寄送 Email 驗證信（重寄最新 pending）=====
router.post('/me/email/resend',
  requireAuthAuto,
  async (req, res) => {
    try {
      const userId = req.user.id;

      // 找最新 pending（未使用且未過期）
      const rows = await mySqlDb.query(
        `SELECT id, new_email, token_hash, expires_at, created_at
         FROM user_email_verifications
         WHERE user_id=? AND used_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );
      const rec = (Array.isArray(rows) && Array.isArray(rows[0])) ? rows[0][0] : rows[0];
      if (!rec) return res.status(404).json({ message: '目前沒有待驗證的 Email' });

      // ✅ 簡單頻率限制：60 秒內不重寄
      const cooldownSec = Number(process.env.EMAIL_RESEND_COOLDOWN_SEC || 60);
      const createdAt = new Date(rec.created_at);
      if (Number.isFinite(createdAt.getTime())) {
        const diffSec = Math.floor((Date.now() - createdAt.getTime()) / 1000);
        if (diffSec < cooldownSec) {
          return res.status(429).json({
            message: `請稍後再試（${cooldownSec - diffSec} 秒後可重新寄送）`
          });
        }
      }

      // ✅ 重做一個新 token（更安全），並更新同一筆 pending
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256Hex(token);

      const expiresMinutes = Number(process.env.EMAIL_VERIFY_EXPIRE_MIN || 30);
      const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

      await mySqlDb.withTransaction(async (tx) => {
        // 鎖住該筆避免 race
        const chk = await tx.query(
          `SELECT id, used_at
           FROM user_email_verifications
           WHERE id=? FOR UPDATE`,
          [rec.id]
        );
        const c = (Array.isArray(chk) && Array.isArray(chk[0])) ? chk[0][0] : chk[0];
        if (!c || c.used_at) {
          const err = new Error('NO_PENDING');
          err.code = 'NO_PENDING';
          throw err;
        }

        await tx.query(
          `UPDATE user_email_verifications
           SET token_hash=?,
               expires_at=?,
               created_at=NOW(),
               created_ip=?,
               user_agent=?
           WHERE id=?`,
          [
            tokenHash,
            expiresAt,
            getClientIp(req),
            clampStr(req.headers['user-agent'], 255),
            rec.id
          ]
        );

        await writeAuditLogTx(tx, req, {
          action: 'USER_RESEND_EMAIL_VERIFY',
          targetUserId: userId,
          detail: { newEmail: rec.new_email, expiresAt }
        });
      });

      // ✅ 寄信（失敗也不要讓整個流程死掉）
      const baseUrl = getBaseUrl(req);
      const link = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

      try {
        await sendMail({
          to: rec.new_email,
          subject: 'TMC SHOP - Email 變更驗證（重新寄送）',
          text: `請點擊以下連結完成 Email 變更驗證（${expiresMinutes} 分鐘內有效）：\n${link}`,
          html: `
            <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
              <p>您好，</p>
              <p>這是重新寄送的 Email 驗證信，請點擊以下連結完成驗證（<b>${expiresMinutes}</b> 分鐘內有效）：</p>
              <p><a href="${link}">${link}</a></p>
              <p>若非本人操作，請忽略本信。</p>
            </div>
          `
        });
      } catch (mailErr) {
        console.error('[resend email] send failed:', mailErr);
        return res.status(202).json({
          status: 'pending',
          message: '已更新驗證資訊，但驗證信寄送失敗，請確認 SMTP 設定或稍後再試'
        });
      }

      return res.status(200).json({ status: 'success', message: '已重新寄送驗證信' });

    } catch (e) {
      if (e?.code === 'NO_PENDING') return res.status(404).json({ message: '目前沒有待驗證的 Email' });
      console.error('resend email error:', e);
      return res.status(500).json({ message: 'resend failed' });
    }
  }
);


// 三、你要快速驗證 Gmail SMTP 是否正常（我建議你加一個測試 API）
// 在 apis/api.js 加一個暫時測試用（只給 admin 才能打最好）：
// ===== SMTP 測試信（只給 user:manage；可指定收件人）=====
// GET  /api/admin/test-email?to=xxx@xxx.com&subject=...&text=...&html=...
// POST /api/admin/test-email { to, subject, text, html }
router.all('/admin/test-email',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    try {
      const input = req.method === 'GET' ? (req.query || {}) : (req.body || {});

      const to = String(input.to || req.user.email || '').trim();
      const subject = String(input.subject || 'SMTP 測試信 - TMC SHOP').trim().slice(0, 120);
      const text = String(input.text || '這是一封測試信（SMTP test）').slice(0, 2000);
      const html = String(input.html || `<b>這是一封測試信（SMTP test）</b><br><div style="color:#666;font-size:12px;">Sent at ${new Date().toISOString()}</div>`);

      if (!to) return res.status(400).json({ message: 'to required' });

      // 可選：基本 email 格式檢查（沿用你 security.js 的 isValidEmail 也可以）
      if (typeof isValidEmail === 'function' && !isValidEmail(to)) {
        return res.status(400).json({ message: 'to email 格式不正確' });
      }

      const startedAt = Date.now();

      const info = await sendMail({
        to,
        subject,
        text,
        html
      });

      const ms = Date.now() - startedAt;

      // 審計（可選：企業習慣會留）
      try {
        await mySqlDb.withTransaction(async (tx) => {
          await writeAuditLogTx(tx, req, {
            action: 'ADMIN_SMTP_TEST_EMAIL',
            targetUserId: null,
            detail: { to, subject, ms, messageId: info?.messageId || null }
          });
        });
      } catch (auditErr) {
        console.warn('[smtp-test] audit log failed:', auditErr?.message || auditErr);
      }

      return res.status(200).json({
        status: 'success',
        to,
        ms,
        messageId: info?.messageId || null,
        response: info?.response || null
      });

    } catch (e) {
      console.error('test email failed:', e);
      return res.status(500).json({
        message: e?.message || 'send failed',
        code: e?.code || null
      });
    }
  }
);

// ✅ 1) /api/admin/smtp-status（可直接貼到 apis/api.js）
// 需要 Node 內建 dns / net：不用裝套件
const dns = require('dns');
const net = require('net');

// ===== SMTP 設定狀態（不發信，只做 env / DNS / TCP 檢測）=====
// GET /api/admin/smtp-status?timeout=3000
router.get('/admin/smtp-status',
  requireAuthAuto,
  requirePermission('user:manage'),
  async (req, res) => {
    const timeoutMs = Math.max(500, Math.min(15000, Number(req.query?.timeout) || 3000));

    // 你專案用到的必要欄位（可依你 mailer.js 實際 requireEnv 調整）
    const required = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
      'APP_BASE_URL'
    ];

    const env = {};
    for (const k of required) env[k] = process.env[k];

    const missing = required.filter(k => !String(env[k] || '').trim());

    // 敏感資訊保護：不要回傳密碼原文
    const safeEnv = {
      SMTP_HOST: env.SMTP_HOST ? String(env.SMTP_HOST) : '',
      SMTP_PORT: env.SMTP_PORT ? String(env.SMTP_PORT) : '',
      SMTP_USER: env.SMTP_USER ? String(env.SMTP_USER) : '',
      SMTP_PASS: env.SMTP_PASS ? '***set***' : '',
      SMTP_FROM: env.SMTP_FROM ? String(env.SMTP_FROM) : '',
      APP_BASE_URL: env.APP_BASE_URL ? String(env.APP_BASE_URL) : ''
    };

    // DNS lookup
    const host = String(env.SMTP_HOST || '').trim();
    let dnsResult = { ok: false, host, address: null, family: null, error: null };

    async function dnsLookup(h) {
      return await new Promise((resolve) => {
        if (!h) return resolve({ ok: false, host: h, address: null, family: null, error: 'SMTP_HOST empty' });
        dns.lookup(h, { all: false }, (err, address, family) => {
          if (err) {
            return resolve({ ok: false, host: h, address: null, family: null, error: err.message || String(err) });
          }
          resolve({ ok: true, host: h, address, family, error: null });
        });
      });
    }

    // TCP connect test
    const port = Number(env.SMTP_PORT);
    let tcpResult = { ok: false, host, port: Number.isFinite(port) ? port : null, ms: null, error: null };

    async function tcpTest(h, p) {
      return await new Promise((resolve) => {
        if (!h) return resolve({ ok: false, host: h, port: p, ms: null, error: 'SMTP_HOST empty' });
        if (!Number.isFinite(p) || p <= 0) return resolve({ ok: false, host: h, port: p, ms: null, error: 'SMTP_PORT invalid' });

        const startedAt = Date.now();
        const sock = net.connect({ host: h, port: p });

        const done = (out) => {
          try { sock.destroy(); } catch {}
          resolve(out);
        };

        sock.setTimeout(timeoutMs);

        sock.on('connect', () => {
          const ms = Date.now() - startedAt;
          done({ ok: true, host: h, port: p, ms, error: null });
        });

        sock.on('timeout', () => {
          const ms = Date.now() - startedAt;
          done({ ok: false, host: h, port: p, ms, error: `timeout after ${timeoutMs}ms` });
        });

        sock.on('error', (err) => {
          const ms = Date.now() - startedAt;
          done({ ok: false, host: h, port: p, ms, error: err?.message || String(err) });
        });
      });
    }

    try {
      dnsResult = await dnsLookup(host);

      // TCP 測試：用 host（讓它一起驗證 DNS + 連線路徑）
      tcpResult = await tcpTest(host, port);

      const ok = missing.length === 0 && dnsResult.ok && tcpResult.ok;

      return res.status(200).json({
        status: ok ? 'ok' : 'not_ready',
        timeoutMs,
        env: safeEnv,
        missing,
        dns: dnsResult,
        tcp: tcpResult,
        tips: buildSmtpTips({ missing, dnsResult, tcpResult, host, port })
      });
    } catch (e) {
      console.error('smtp-status error:', e);
      return res.status(500).json({ message: e?.message || 'smtp-status failed' });
    }
  }
);

// 小工具：給一些快速提示（不依賴外部套件）
function buildSmtpTips({ missing, dnsResult, tcpResult, host, port }) {
  const tips = [];
  if (missing?.length) tips.push(`缺少環境變數：${missing.join(', ')}`);

  if (host && /gmail\.com$/i.test(host)) {
    tips.push('Gmail 建議 SMTP_PORT=587（STARTTLS）或 465（SSL）；帳密需用 App Password（非登入密碼）');
  }

  if (!dnsResult?.ok) {
    tips.push('DNS 解析失敗：請確認 SMTP_HOST 是否正確、VM 是否可解析 DNS（/etc/resolv.conf）、或公司 DNS/防火牆限制');
  } else {
    tips.push(`DNS OK：${host} -> ${dnsResult.address}`);
  }

  if (!tcpResult?.ok) {
    tips.push('TCP 連線失敗：常見原因是防火牆/安全群組沒放行、公司網路封鎖 587/465、或 SMTP 服務端拒絕連線');
    tips.push('Ubuntu 可用：nc -vz <host> <port> 或 telnet <host> <port> 測試');
  } else {
    tips.push(`TCP OK：${host}:${port} connect ${tcpResult.ms}ms`);
  }

  return tips;
}





module.exports = router;


