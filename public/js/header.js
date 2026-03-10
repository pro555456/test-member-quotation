(function () {
  function setShopcartCount() {
    try {
      const raw = localStorage.getItem("shopcart");
      const arr = raw ? JSON.parse(raw) : [];
      const n = Array.isArray(arr) ? arr.length : 0;
      $("#shopcart").text(`購物車(${n})`);
    } catch {
      $("#shopcart").text(`購物車(0)`);
    }
  }

  // 未登入狀態：只顯示「登入」
  function hideAllAuthLinks() {
    $("#navLogin").removeClass("d-none");
    $("#navProfile,#navHistory,#navAdmin,#navAdminUsers,#navSmtpTest,#navLogout,#navDivider").addClass("d-none");
  }

  // 已登入狀態：顯示「我的資料 / 訂單 / 登出」
  function showLoggedInBaseLinks() {
    $("#navLogin").addClass("d-none");
    $("#navProfile,#navHistory,#navLogout,#navDivider").removeClass("d-none");
  }

  async function refreshNav() {
    hideAllAuthLinks();

    try {
      // axios-auth 會自動 refresh
      const me = await axios.get("/api/me");
      const user = me?.data?.user || null;
      const perms = Array.isArray(me?.data?.perms) ? me.data.perms : [];

      // 已登入：先顯示基本入口（我的資料/訂單/登出）
      if (user) showLoggedInBaseLinks();

      // ✅ 用 permissions 決定後台入口（不看 type）
      const has = (p) => perms.includes(p);

      // 你可以二選一：
      // - 如果你有設計 admin:access，就用它做「後台入口」總開關
      // - 否則用 product:write 當作能看到「後台管理」的條件
      const canSeeAdmin = has("admin:access") || has("product:write");
      const canManageUsers = has("user:manage");

      if (canSeeAdmin) $("#navAdmin").removeClass("d-none");
      if (canManageUsers) $("#navAdminUsers").removeClass("d-none");
      if (canManageUsers) $("#navSmtpTest").removeClass("d-none");

    } catch (e) {
      // 未登入：維持預設（只顯示登入）
    }
  }

  async function doLogout(e) {
    e.preventDefault();
    try {
      await axios.post("/api/logout");
    } catch {}

    alert("您已登出成功！");
    window.location.href = "/index";
  }

  function bindEvents() {
    $("#navLogout").off("click").on("click", doLogout);
    $("#btnShopcart").off("click").on("click", () => (window.location.href = "/shopcart"));
  }

  $(document).ready(async function () {
    setShopcartCount();
    bindEvents();
    await refreshNav();
  });

  window.addEventListener("shopcart:changed", setShopcartCount);
})();
