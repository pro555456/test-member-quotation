const express = require('express')
const router = express.Router()
const { requireAuthPage, requireAdminPage } = require('../middlewares/auth');
const { requireAuthPageAuto } = require('../middlewares/auth');
const { requirePermissionPage } = require('../middlewares/rbac');
// const { requireAuth, requireAuthPage, requireAdminPage } = require('../middlewares/auth');
// const { requireAuth, requireAdmin, requireAuthPage, requireAdminPage } = require('../middlewares/auth');


// 前台
router.route('/')
.get((req, res) => res.redirect('/index'));

router.route('/index')
.get((req, res) => res.render('index.ejs'))
.post((req, res) => res.render('index.ejs'));

router.route('/login')
.get((req, res) => res.render('login.ejs'))

router.route('/register')
.get((req,res) => res.render('register.ejs'))

router.route('/history')
.get((req,res) => res.render('history', { title: '訂單紀錄' }));
// .get((req,res) => res.render('history.ejs'))

router.route('/shopcart')
.get((req, res) => res.render('shopcart', { title: '購物車 - TMC SHOP' }))
// .get((req, res) => res.render('shopcart.ejs'))
.post((req, res) => res.render('shopcart.ejs'))


// ③（建議）頁面路由也要一致：staff 點「人員管理」就算硬打網址也進不去
// 你已經有 requirePermissionPage('user:manage')，所以只要 pages.js 這樣保護就 OK：
router.get('/admin',
  requireAuthPageAuto,
  requirePermissionPage('product:write', { onForbiddenRedirect: '/history' }),
  (req, res) => res.render('admin', { title: '後台管理' })
);

router.get('/admin/users',
  requireAuthPageAuto,
  requirePermissionPage('user:manage', { onForbiddenRedirect: '/history' }),
  (req, res) => res.render('admin_users', { title: '人員管理' })
);

router.get('/profile', requireAuthPageAuto, (req, res) => {
  return res.render('profile', {
    title: '我的資料'
  });
});

router.get('/verify-email', (req, res) => {
  // 只 render 頁面，由前端呼叫 /api/me/email/verify?token=...
  res.render('verify_email', { title: 'Email 驗證' });
});

router.get('/verify-register-email', (req, res) => {
  res.render('verify_register_email', { title: 'Email 驗證' });
});

router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', { title: '忘記密碼' });
});

router.get('/reset-password', (req, res) => {
  res.render('reset_password', { title: '重設密碼' });
});

// 2) ✅ 做一個 SMTP 測試頁面（只給 admin）
// 2-1) pages route：GET /admin/smtp-test
// 在你的 pages.js（或你的 view router）加上：
router.get('/admin/smtp-test',
  requireAuthPageAuto,
  requirePermissionPage('user:manage'),
  (req, res) => {
    res.render('admin_smtp_test', { title: 'SMTP 測試' });
  }
);




// // 後台首頁：需要 product:write 或者你定義的 admin:access
// router.get('/admin',
//   requireAuthPageAuto,
//   requirePermissionPage('product:write', { onForbiddenRedirect: '/login' }),
//   (req, res) => {
//   res.render('admin', { title: '產品管理 - TMC 後台' });
//   });
//   // (req, res) => res.render('admin.ejs')

// // 人員管理：需要 user:manage
// router.get('/admin/users',
//   requireAuthPageAuto,
//   requirePermissionPage('user:manage', { onForbiddenRedirect: '/login' }),
//   (req, res) => res.render('admin_users', { title: '人員管理 - TMC 後台' })
// );

module.exports = router;








