(function () {
  const PUBLIC_OR_OPTIONAL_AUTH_APIS = [
    '/api/me',
    '/api/security/config',
    '/api/health',
  ];

  const NEVER_REFRESH_APIS = [
    '/api/refresh',
    '/api/logout',
  ];

  function isApiRequest(config) {
    const url = config?.url || '';
    return typeof url === 'string' && url.startsWith('/api/');
  }

  function isPublicApi(url) {
    return PUBLIC_OR_OPTIONAL_AUTH_APIS.some((prefix) => url === prefix || url.startsWith(`${prefix}?`));
  }

  function isNeverRefreshApi(url) {
    return NEVER_REFRESH_APIS.some((prefix) => url === prefix || url.startsWith(`${prefix}?`));
  }

  async function refreshAccessToken() {
    await axios.post('/api/refresh', null, {
      __skipAuthRefresh: true,
    });
  }

  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error?.config || {};
      const status = error?.response?.status;
      const url = originalRequest?.url || '';

      if (!isApiRequest(originalRequest)) {
        return Promise.reject(error);
      }

      if (originalRequest.__skipAuthRefresh) {
        return Promise.reject(error);
      }

      if (status !== 401) {
        return Promise.reject(error);
      }

      if (isNeverRefreshApi(url) || isPublicApi(url)) {
        return Promise.reject(error);
      }

      if (originalRequest.__isRetryRequest) {
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        await refreshAccessToken();
        originalRequest.__isRetryRequest = true;
        return axios(originalRequest);
      } catch (refreshError) {
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
  );
})();
