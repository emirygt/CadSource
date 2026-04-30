// ── Initialization ──
const _PAGE_NAMES = ['search','db','approved','contour','cat','nl-search','attr-defs','analytics','activity','duplicates','scan'];
const _PAGE_V = '20260430';

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
  const navMap = { analytics:'nav-dashboard', search:'nav-search', db:'nav-library-db', approved:'nav-library-approved', contour:'nav-contour', scan:'nav-scan', cat:'nav-cat', 'attr-defs':'nav-attr-defs', activity:'nav-activity', duplicates:'nav-duplicates', 'nl-search':'nav-nl-search' };
  setActiveNav(document.getElementById(navMap[startPage] || 'nav-dashboard'));
  loadStats();
})();
