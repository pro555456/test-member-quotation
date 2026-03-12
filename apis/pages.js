const express = require('express');

const router = express.Router();
const { requireAuthPageAuto } = require('../middlewares/auth');
const { requirePermissionPage } = require('../middlewares/rbac');
const adminAnalyticsService = require('../services/adminAnalyticsService');

router.get('/', (req, res) => res.render('login', { title: '登入 - 遊戲檢測報價平台' }));
router.get('/login', (req, res) => res.render('login', { title: '登入 - 遊戲檢測報價平台' }));
router.get('/index', (req, res) => res.redirect('/dashboard'));
router.get('/shopcart', (req, res) => res.redirect('/quotes'));
router.get('/history', (req, res) => res.redirect('/cases'));
router.get('/admin', (req, res) => res.redirect('/dashboard'));

router.get('/dashboard', requireAuthPageAuto, (req, res) => {
  res.render('dashboard', { title: '後台儀表板 - 遊戲檢測報價平台' });
});

router.get('/quotes', requireAuthPageAuto, (req, res) => {
  res.render('quotes', { title: '報價單管理 - 遊戲檢測報價平台' });
});

router.get('/quotes/new', requireAuthPageAuto, (req, res) => {
  res.render('quote_form', {
    title: '新增報價單 - 遊戲檢測報價平台',
    mode: 'create',
    quoteId: null,
  });
});

router.get('/quotes/:id', requireAuthPageAuto, (req, res) => {
  res.render('quote_form', {
    title: '報價單詳情 - 遊戲檢測報價平台',
    mode: 'edit',
    quoteId: Number(req.params.id),
  });
});

router.get('/cases', requireAuthPageAuto, (req, res) => {
  res.render('cases', { title: '案件追蹤 - 遊戲檢測報價平台' });
});

router.get('/admin/analytics', requireAuthPageAuto, requirePermissionPage('admin:access', { onForbiddenRedirect: '/dashboard' }), (req, res) => {
  res.render('admin_analytics', { title: '管理分析 - 遊戲檢測報價平台' });
});

router.get('/admin/analytics/print', requireAuthPageAuto, requirePermissionPage('admin:access', { onForbiddenRedirect: '/dashboard' }), async (req, res, next) => {
  try {
    const analytics = await adminAnalyticsService.getAdminAnalytics({
      period: req.query?.period,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
    });

    res.render('admin_analytics_print', {
      layout: false,
      title: '管理分析列印版 - 遊戲檢測報價平台',
      analytics,
      autoPrint: req.query?.autoprint === '1',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/users', requireAuthPageAuto, requirePermissionPage('user:manage', { onForbiddenRedirect: '/dashboard' }), (req, res) => {
  res.render('admin_users', { title: '人員管理 - 遊戲檢測報價平台' });
});

router.get('/profile', requireAuthPageAuto, (req, res) => {
  res.render('profile', { title: '我的資料 - 遊戲檢測報價平台' });
});

router.get('/verify-email', (req, res) => {
  res.render('verify_email', { title: 'Email 驗證 - 遊戲檢測報價平台' });
});

router.get('/verify-register-email', (req, res) => {
  res.render('verify_register_email', { title: 'Email 驗證 - 遊戲檢測報價平台' });
});

router.get('/register', (req, res) => {
  res.render('register', { title: '建立帳號 - 遊戲檢測報價平台' });
});

router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', { title: '忘記密碼 - 遊戲檢測報價平台' });
});

router.get('/reset-password', (req, res) => {
  res.render('reset_password', { title: '重設密碼 - 遊戲檢測報價平台' });
});

router.get('/admin/smtp-test', requireAuthPageAuto, requirePermissionPage('user:manage', { onForbiddenRedirect: '/dashboard' }), (req, res) => {
  res.render('admin_smtp_test', { title: 'SMTP 測試 - 遊戲檢測報價平台' });
});

module.exports = router;
