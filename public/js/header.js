(function () {
  function hideAllAuthLinks() {
    $("#navLogin").removeClass("d-none");
    $("#navProfile,#navDashboardWrap,#navQuotesWrap,#navCasesWrap,#navAdminAnalyticsWrap,#navAdminUsersWrap,#navSmtpTestWrap,#navLogout,#navDivider").addClass("d-none");
  }

  function showLoggedInBaseLinks() {
    $("#navLogin").addClass("d-none");
    $("#navProfile,#navDashboardWrap,#navQuotesWrap,#navCasesWrap,#navLogout,#navDivider").removeClass("d-none");
  }

  async function refreshNav() {
    hideAllAuthLinks();

    try {
      const me = await axios.get("/api/me");
      const user = me?.data?.user || null;
      const perms = Array.isArray(me?.data?.perms) ? me.data.perms : [];
      const has = (perm) => perms.includes(perm);

      if (user) {
        showLoggedInBaseLinks();
        if (user?.name) {
          $("#navUserMenu").text(user.name);
        }
      }

      if (has("admin:access")) {
        $("#navAdminAnalyticsWrap").removeClass("d-none");
      }

      if (has("user:manage")) {
        $("#navAdminUsersWrap,#navSmtpTestWrap").removeClass("d-none");
      }
    } catch (_) {
      $("#navUserMenu").text("帳號");
    }
  }

  async function doLogout(event) {
    event.preventDefault();
    try {
      await axios.post("/api/logout");
    } catch (_) {
    }
    window.location.href = "/login";
  }

  function bindEvents() {
    $("#navLogout").off("click").on("click", doLogout);
  }

  $(document).ready(async function () {
    bindEvents();
    await refreshNav();
  });
})();
