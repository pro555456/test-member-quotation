const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit'); // ✅ 重要：用它處理 IPv6

// 登入防爆破：以 IP + account 組合做 key（更準）
// - ipKeyGenerator(req) 會把 IPv6/代理等情況轉成一致格式
// - account 加進去可以避免同 IP 多人共用時互相影響太大
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000), // 15 分鐘
  max: Number(process.env.LOGIN_RATE_MAX || 10), // 15 分鐘最多 10 次（可調）
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many login attempts. Please try again later.' },

  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req); // ✅ 取代 req.ip
    const account = String(req.body?.account || '').toLowerCase().trim();
    return account ? `${ip}:${account}` : ip;
  },
});

module.exports = { loginLimiter };


// // middlewares/rateLimit.js
// const rateLimit = require('express-rate-limit');

// const loginLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 分鐘
//   max: 10,                  // 同一來源最多 10 次嘗試
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { status: 'error', message: 'Too many login attempts, please try again later.' },

//   // 你也可以把 account 加進去做更細緻的限制（避免同 IP 多帳號）
//   keyGenerator: (req) => {
//     const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
//     const account = (req.body?.account || '').toString().toLowerCase();
//     return `${ip}:${account}`;
//   },
// });

// module.exports = { loginLimiter };
