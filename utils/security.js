// ✅ utils/security.js（整份可覆蓋）
// utils/security.js

// 1. 定義集中化的常數，方便維護並確保驗證與處理的一致性
const SECURITY_CONFIG = {
  ACCOUNT_MIN: 3,
  ACCOUNT_MAX: 32,
  EMAIL_MAX: 200,
  PWD_MIN: 10,
  PWD_MAX: 72, // bcrypt 的有效上限通常為 72 字符
};

/**
 * 基礎截斷工具：增加最大長度強制保護，防止超長字串消耗系統資源
 */
function clampStr(v, max = 255) {
  const s = String(v ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeAccount(v) {
  return clampStr(v, SECURITY_CONFIG.ACCOUNT_MAX).toLowerCase();
}

function normalizeEmail(v) {
  return clampStr(v, SECURITY_CONFIG.EMAIL_MAX).toLowerCase();
}

/**
 * 帳號驗證：預先定義正則表達式，避免每次執行函數都重新編譯
 * 規則對齊 ACCOUNT_MIN / ACCOUNT_MAX：
 * - 第一碼必須是英文字母
 * - 後續允許 a-z0-9._-
 * - 總長度：ACCOUNT_MIN ~ ACCOUNT_MAX
 */
const ACCOUNT_REGEX = new RegExp(
  `^[a-z][a-z0-9._-]{${Math.max(0, SECURITY_CONFIG.ACCOUNT_MIN - 1)},${Math.max(0, SECURITY_CONFIG.ACCOUNT_MAX - 1)}}$`
);

function isValidAccount(account) {
  if (!account) return false;
  return ACCOUNT_REGEX.test(account);
}

/**
 * Email 驗證：採用更嚴謹但符合現代標準的格式
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(email) {
  // ⚠️ 這裡維持你原本設計：允許選填；必填由業務邏輯(API)處理
  if (!email) return true;
  return email.length <= SECURITY_CONFIG.EMAIL_MAX && EMAIL_REGEX.test(email);
}

/**
 * ✅ 由 SECURITY_CONFIG 自動產生密碼規則文字（不手寫固定文案）
 * 只要改 SECURITY_CONFIG，文字就會同步更新
 */
function getPasswordPolicyText() {
  const parts = [];

  // 長度
  parts.push(`密碼長度需介於 ${SECURITY_CONFIG.PWD_MIN}～${SECURITY_CONFIG.PWD_MAX} 碼`);

  // 複雜度（目前是固定檢查 4 類：小寫/大寫/數字/符號）
  // 這裡不寫死「至少 8 碼」等，而是由 config 的 min/max 控制。
  parts.push('需包含：小寫字母、大寫字母、數字、符號');

  // 關聯性規則（你目前策略：不可包含帳號）
  parts.push('不可包含帳號');

  return parts.join('；') + '。';
}

/**
 * 密碼策略檢查（訊息也改成讀 config）
 */
function passwordPolicyCheck(pwd, account) {
  const p = String(pwd || '');

  // 1) 長度檢查
  if (p.length < SECURITY_CONFIG.PWD_MIN) return `密碼至少 ${SECURITY_CONFIG.PWD_MIN} 碼`;
  if (p.length > SECURITY_CONFIG.PWD_MAX) return `密碼長度不可超過 ${SECURITY_CONFIG.PWD_MAX} 碼`;

  // 2) 複雜度檢查
  if (!/[a-z]/.test(p)) return '密碼需包含小寫字母';
  if (!/[A-Z]/.test(p)) return '密碼需包含大寫字母';
  if (!/[0-9]/.test(p)) return '密碼需包含數字';
  if (!/[^A-Za-z0-9]/.test(p)) return '密碼需包含符號';

  // 3) 關聯性檢查：不可包含帳號
  if (account && String(account).length >= SECURITY_CONFIG.ACCOUNT_MIN) {
    const normAcc = String(account).toLowerCase();
    const normPwd = p.toLowerCase();
    if (normPwd.includes(normAcc)) return '密碼不可包含帳號';
  }

  return null;
}

function getPublicSecurityConfig() {
  return {
    ACCOUNT_MIN: SECURITY_CONFIG.ACCOUNT_MIN,
    ACCOUNT_MAX: SECURITY_CONFIG.ACCOUNT_MAX,
    EMAIL_MAX: SECURITY_CONFIG.EMAIL_MAX,
    PWD_MIN: SECURITY_CONFIG.PWD_MIN,
    PWD_MAX: SECURITY_CONFIG.PWD_MAX,
    passwordPolicyText: getPasswordPolicyText()
  };
}


module.exports = {
  normalizeAccount,
  normalizeEmail,
  isValidAccount,
  isValidEmail,
  passwordPolicyCheck,
  getPasswordPolicyText, // ✅ 新增：給前端顯示用
  getPublicSecurityConfig, // ✅ 新增：取得公開的安全設定
  SECURITY_CONFIG
};


