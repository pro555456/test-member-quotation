// ?臭誑???曉?鞊∪???axios-auth.js ????401?賜??仿暹??????潭嚗?// ?祇??嚗?register??verify-register-email嚗??唳???401 API
// ??典停??/api/refresh
// refresh 銋仃??// ?敺撥?嗅???/login
// ????餃銋????銝???// 銝??亦策雿?隞??航??? public/js/axios-auth.js嚗?鈭嗾隞嗡?嚗?// ???芣???閬?亦? API????閰?refresh
// ??撠?? API ??401嚗? refresh??頝?login
// ??撠?/api/me ?車?靘炎?交?衣?乓? API嚗?01 閬甇?虜嚗? refresh
// ???踹? refresh ?⊿?餈游?
// ??憭?瘙???401 ???芾?銝甈?refresh嚗隞???蝯?
// ?航??? public/js/axios-auth.js

(function () {
  // ===== ?臭??瘙矽??=====

  // ????砌?撠勗?閮望?餃?汗嚗???銝?401 銝??芸? refresh / 銝?撘瑕頝?login
  const PUBLIC_PAGES = new Set([
    '/login',
    '/register',
    '/verify-register-email',
    '/verify-email',
        '/'
  ]);

  // ?? API ??401 閬?迤撣詨?賜??銝?閫貊 refresh
  // 靘?嚗?  // - /api/me嚗eader.js ?其??斗?臬?餃嚗?餃??401 敺迤撣?  // - /api/security/config嚗雿?敺??寞????嚗ㄐ銋?霅瑚?銝?  const PUBLIC_OR_OPTIONAL_AUTH_APIS = [
    '/api/me',
    '/api/security/config',
    '/api/public/security/config'
  ];

  // refresh / logout ?芸楛銝?鋡急??芸?蹂???refresh嚗?艘??  const NEVER_REFRESH_APIS = [
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

    // 1) ?? API 瘞賊?銝?refresh
    if (matchApi(url, NEVER_REFRESH_APIS)) return true;

    // 2) ?祇??銝?撠?鈭???舫?餃 API ??401嚗? refresh
    if (isPublicPage(path) && matchApi(url, PUBLIC_OR_OPTIONAL_AUTH_APIS)) return true;

    // 3) 撠? /api/ ???瘙?銝? auth refresh
    if (!url.startsWith('/api/')) return true;

    return false;
  }

  // ===== axios 閮剖? =====
  axios.defaults.withCredentials = true;

  // ===== refresh ?矽嚗??隢??? refresh嚗?====
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
      __skipAuthRefresh: true // ?芾???嚗?撌勗??脫??芣?蝔?    });
  }

  axios.interceptors.response.use(
    function (response) {
      return response;
    },
    async function (error) {
      const originalRequest = error?.config || {};
      const status = error?.response?.status;

      // 瘝? response嚗?憒雯頝舀蝺imeout嚗?乩??
      if (!error.response) {
        return Promise.reject(error);
      }

      // ?芾???401
      if (status !== 401) {
        return Promise.reject(error);
      }

      // 鋡急?閮歲??auth refresh ??瘙?銝???      if (originalRequest.__skipAuthRefresh) {
        return Promise.reject(error);
      }

      // ?? API / ?祇???401 ?舀迤撣貉??綽?銝?refresh??撠?
      if (shouldSkipAuthHandling(error)) {
        return Promise.reject(error);
      }

      // 撌脩??岫??甈∴??踹??⊿?餈游?
      if (originalRequest.__isRetryRequest) {
        return Promise.reject(error);
      }

      // ===== ?桅? refresh嚗??歇??refresh ?刻?嚗隞?瘙???=====
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

        // ???芣????祇???撘瑕??login
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
