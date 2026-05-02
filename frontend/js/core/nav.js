// ── Tab yönetimi ──────────────────────────────────────────────────────────────
function setActiveNav(el) {
  document.querySelectorAll('.tab.active').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

function toggleLibraryMenu(forceOpen = null) {
  const menu = document.getElementById('libraryMenu');
  const parent = document.getElementById('nav-library');
  if (!menu || !parent) return;
  const next = forceOpen === null ? !menu.classList.contains('open') : !!forceOpen;
  menu.classList.toggle('open', next);
  parent.classList.toggle('expanded', next);
}

function toggleDigitalMenu(forceOpen = null) {
  const menu = document.getElementById('digitalMenu');
  const parent = document.getElementById('nav-digital');
  if (!menu || !parent) return;
  const next = forceOpen === null ? !menu.classList.contains('open') : !!forceOpen;
  menu.classList.toggle('open', next);
  parent.classList.toggle('expanded', next);
}

function apSetFolder(kind, el) {
  document.querySelectorAll('#page-approved .fl-folder-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  const draftPanel = document.getElementById('apPanelDraft');
  const approvedPanel = document.getElementById('apPanelApproved');
  const titleEl = document.getElementById('approvedPageTitle');
  const subEl = document.getElementById('approvedPageSub');
  if (kind === 'approved') {
    if (draftPanel) draftPanel.style.display = 'none';
    if (approvedPanel) { approvedPanel.style.display = 'flex'; }
    if (titleEl) titleEl.textContent = t('approved.approved_title');
    if (subEl) subEl.textContent = t('approved.approved_sub');
  } else {
    if (draftPanel) draftPanel.style.display = 'flex';
    if (approvedPanel) approvedPanel.style.display = 'none';
    if (titleEl) titleEl.textContent = t('approved.review_title');
    if (subEl) subEl.textContent = t('approved.review_sub');
  }
}

function setProductsViewMode(mode) {
  if (mode === 'approved') { apSetFolder('approved', document.getElementById('apFolderApproved')); return; }
  if (mode === 'draft' || mode === 'split') { apSetFolder('draft', document.getElementById('apFolderDraft')); }
}

function navGo(target, el) {
  if (target === 'contour' || target === 'scan') toggleDigitalMenu(true);
  setActiveNav(el);
  switchTab(target);
}

function focusProductsColumn(kind) {
  apSetFolder(kind, document.getElementById(kind === 'approved' ? 'apFolderApproved' : 'apFolderDraft'));
}

function navLibrary(kind, el) {
  toggleLibraryMenu(true);
  setActiveNav(el);
  if (kind === 'db') {
    setProductsViewMode('split');
    switchTab('db');
    return;
  }
  switchTab('approved');
  setProductsViewMode(kind);
  focusProductsColumn(kind);
}

function navDigital(target, el) {
  toggleDigitalMenu(true);
  setActiveNav(el);
  switchTab(target);
}

function navCadEditor(el) {
  toggleDigitalMenu(true);
  setActiveNav(el);
  switchTab('scan');
  setTimeout(() => openAcad(), 0);
}

function switchTab(name, skipHistory = false) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (!skipHistory) history.pushState({ page: name }, '', '/' + name);
  if (name === 'db')        { loadDbFiles(); loadCategoriesIntoSelect(); loadDbAttrDefs(); }
  if (name === 'search')    { loadCategoriesIntoSelect(); loadHistory(); setTimeout(initSearchControls, 0); setTimeout(loadSearchHeroStats, 0); }
  if (name === 'approved')  { setProductsViewMode('split'); loadApprovedFiles(); }
  if (name === 'contour')   initContourTab();
  if (name === 'cat')       loadCategories();
  if (name === 'attr-defs') loadAttrDefs();
  if (name === 'nl-search') loadAttrSearchFilters();
  if (name === 'analytics') loadAnalytics();
  if (name === 'activity')   loadActivityLog();
  if (name === 'scan')       scanInit();
  if (name === 'duplicates')    loadDuplicatePage();
  if (name === 'image-editor')  initImageEditor();
  if (name === 'admin')         initAdminPage();
}

// ── Path routing ──────────────────────────────────────────────────────────────
const _VALID_PAGES = new Set(['search','db','approved','contour','cat','nl-search','attr-defs','analytics','activity','duplicates','scan','image-editor','admin']);

function _routeFromPath() {
  const name = location.pathname.slice(1);
  if (_VALID_PAGES.has(name)) switchTab(name, true);
}

window.addEventListener('popstate', _routeFromPath);

// ── Stats (topbar) ────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    await ensureApiBase(true);
    const r = await fetch(`${API}/stats`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const d = await r.json();
    const totalEl = document.getElementById('totalFiles');
    if (totalEl) totalEl.textContent = Number(d.total_files || 0).toLocaleString('en-US');
    document.getElementById('statusDot').style.background = '#22c55e';
    document.getElementById('statusText').textContent = t('common.connected');
  } catch {
    // Backend sonradan ayağa kalktıysa base'i tekrar keşfet.
    await ensureApiBase(true);
    document.getElementById('statusDot').style.background = '#ef4444';
    document.getElementById('statusText').textContent = t('common.no_connection');
  }
}
