// 可以。你現在的現象很像 axios-auth.js 把所有 401都當成「登入逾期」處理，於是：
// 公開頁面（/register、/verify-register-email）打到某支 401 API
// 攔截器就去 /api/refresh
// refresh 也失敗
// 最後強制導回 /login
// 這對「未登入也能看的頁面」是不對的。
// 下面我直接給你一份 可覆蓋版 public/js/axios-auth.js，做了這幾件事：
// ✅ 只有「需要登入的 API」才會嘗試 refresh
// ✅ 對公開頁 API 的 401，不 refresh、不跳 login
// ✅ 對 /api/me 這種「用來檢查是否登入」的 API，401 視為正常，不 refresh
// ✅ 避免 refresh 無限迴圈
// ✅ 多個請求同時 401 時，只跑一次 refresh，其他排隊等結果
// 可覆蓋版 public/js/axios-auth.js

(function () {
  // ===== 可依需求調整 =====

  // 這些頁面本來就允許未登入瀏覽；在這些頁面上，401 不應自動 refresh / 不應強制跳 login
  const PUBLIC_PAGES = new Set([
    '/login',
    '/register',
    '/verify-register-email',
    '/verify-email',
    '/index',
    '/'
  ]);

  // 這些 API 的 401 視為「正常可能發生」，不要觸發 refresh
  // 例如：
  // - /api/me：header.js 用來判斷是否登入，未登入回 401 很正常
  // - /api/security/config：若你之後又改成某些版本，這裡也保護一下
  const PUBLIC_OR_OPTIONAL_AUTH_APIS = [
    '/api/me',
    '/api/security/config',
    '/api/public/security/config'
  ];

  // refresh / logout 自己不要被攔截器拿來再 refresh，避免迴圈
  const NEVER_REFRESH_APIS = [
    '/api/refresh',
    '/api/logout'
  ];

  function getCurrentPath() {
    try {
      return window.location.pathname || '/';
    } catch {
      return '/';
    }
  }

  function isPublicPage(pathname) {
    return PUBLIC_PAGES.has(pathname);
  }

  function matchApi(url, patterns) {
    if (!url) return false;
    return patterns.some((p) => url === p || url.startsWith(p + '?'));
  }

  function shouldSkipAuthHandling(error) {
    const url = error?.config?.url || '';
    const path = getCurrentPath();

    // 1) 這些 API 永遠不 refresh
    if (matchApi(url, NEVER_REFRESH_APIS)) return true;

    // 2) 公開頁面上，對某些公開/可選登入 API 的 401，不 refresh
    if (isPublicPage(path) && matchApi(url, PUBLIC_OR_OPTIONAL_AUTH_APIS)) return true;

    // 3) 對非 /api/ 開頭的請求，不做 auth refresh
    if (!url.startsWith('/api/')) return true;

    return false;
  }

  // ===== axios 設定 =====
  axios.defaults.withCredentials = true;

  // ===== refresh 協調（避免多請求同時 refresh）=====
  let isRefreshing = false;
  let refreshWaiters = [];

  function addRefreshWaiter(resolve, reject) {
    refreshWaiters.push({ resolve, reject });
  }

  function resolveRefreshWaiters() {
    refreshWaiters.forEach(({ resolve }) => resolve());
    refreshWaiters = [];
  }

  function rejectRefreshWaiters(err) {
    refreshWaiters.forEach(({ reject }) => reject(err));
    refreshWaiters = [];
  }

  async function doRefresh() {
    return axios.post('/api/refresh', {}, {
      withCredentials: true,
      __skipAuthRefresh: true // 自訂旗標：避免自己再進攔截流程
    });
  }

  axios.interceptors.response.use(
    function (response) {
      return response;
    },
    async function (error) {
      const originalRequest = error?.config || {};
      const status = error?.response?.status;

      // 沒有 response（例如網路斷線、timeout）直接丟回去
      if (!error.response) {
        return Promise.reject(error);
      }

      // 只處理 401
      if (status !== 401) {
        return Promise.reject(error);
      }

      // 被標記跳過 auth refresh 的請求，不處理
      if (originalRequest.__skipAuthRefresh) {
        return Promise.reject(error);
      }

      // 某些 API / 公開頁 401 是正常行為，不 refresh、不導頁
      if (shouldSkipAuthHandling(error)) {
        return Promise.reject(error);
      }

      // 已經重試過一次，避免無限迴圈
      if (originalRequest.__isRetryRequest) {
        return Promise.reject(error);
      }

      // ===== 單飛 refresh：如果已有 refresh 在跑，其他請求排隊 =====
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          addRefreshWaiter(
            async () => {
              try {
                originalRequest.__isRetryRequest = true;
                const resp = await axios(originalRequest);
                resolve(resp);
              } catch (e) {
                reject(e);
              }
            },
            (err) => reject(err)
          );
        });
      }

      isRefreshing = true;

      try {
        await doRefresh();
        isRefreshing = false;
        resolveRefreshWaiters();

        originalRequest.__isRetryRequest = true;
        return axios(originalRequest);
      } catch (refreshErr) {
        isRefreshing = false;
        rejectRefreshWaiters(refreshErr);

        // ✅ 只有「非公開頁」才強制回 login
        const currentPath = getCurrentPath();
        if (!isPublicPage(currentPath)) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?next=${next}`;
        }

        return Promise.reject(refreshErr);
      }
    }
  );
})();