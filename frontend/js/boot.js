// ── Initialization ──
(function init() {
  applyI18n();
  updateLangBtn();
  const searchShell = document.getElementById('searchStartShell');
  if (searchShell) searchStartInitialHtml = searchShell.innerHTML;
  initSearchControls();
  switchTab('analytics');
  setActiveNav(document.getElementById('nav-dashboard'));
  loadStats();
})();
