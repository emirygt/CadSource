// ── Initialization ──
const _PAGE_NAMES = ['search','db','approved','contour','cat','attr-defs','analytics','activity','duplicates','scan','image-editor','admin','reports','decisions'];
const _PAGE_V = '20260502';

(async function init() {
  const app = document.getElementById('app');
  const htmls = await Promise.all(
    _PAGE_NAMES.map(name => fetch(`pages/${name}.html?v=${_PAGE_V}`).then(r => r.text()))
  );
  const loadingEl = document.getElementById('app-loading');
  if (loadingEl) loadingEl.remove();
  htmls.forEach(html => app.insertAdjacentHTML('beforeend', html));

  applyI18n();
  updateLangBtn();
  const searchShell = document.getElementById('searchStartShell');
  if (searchShell) searchStartInitialHtml = searchShell.innerHTML;
  initSearchControls();
  const rawPath = location.pathname.slice(1);
  const startPage = _VALID_PAGES.has(rawPath) ? rawPath : 'analytics';
  if (!_VALID_PAGES.has(rawPath)) history.replaceState({ page: startPage }, '', '/' + startPage);
  switchTab(startPage, true);
  const navMap = { analytics:'nav-analytics', search:'nav-search', db:'nav-db', approved:'nav-db', contour:'nav-contour', scan:'nav-scan', cat:'nav-cat', 'attr-defs':'nav-attr-defs', activity:'nav-activity', duplicates:'nav-duplicates', 'image-editor':'nav-scan', admin:'nav-admin', reports:'nav-reports', decisions:'nav-decisions' };
  setActiveNav(document.getElementById(navMap[startPage] || 'nav-dashboard'));
  loadStats();
  fetch(`${API}/admin/my-permissions`, { headers: authH() })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d?.nav_items) applyNavPermissions(d.nav_items); })
    .catch(() => {});
})();
