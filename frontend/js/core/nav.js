const NAV_PERM_GROUPS = [
  { group: 'Ara & Karşılaştır', items: [
    { id: 'nav-search',  label: 'Arama' },
    { id: 'nav-compare', label: 'Karşılaştırma' },
    { id: 'nav-filter',  label: 'Filtreleme' },
  ]},
  { group: 'Kütüphane', items: [
    { id: 'nav-db-upload',  label: 'Yükleme & Arşivleme' },
    { id: 'nav-db',         label: 'Profil / Kalıp Havuzu' },
    { id: 'nav-cat',        label: 'Kategoriler & Etiketler' },
    { id: 'nav-attr-defs',  label: 'Attribute Tanımları' },
    { id: 'nav-duplicates', label: 'Mükerrer Kayıtlar' },
  ]},
  { group: 'Dijitalleştirme', items: [
    { id: 'nav-contour', label: 'Fotoğraftan Kontura' },
    { id: 'nav-scan',    label: 'Numuneden Çizime Hazırlık' },
  ]},
  { group: 'Kararlar & Raporlar', items: [
    { id: 'nav-reports',   label: 'Raporlar' },
    { id: 'nav-activity',  label: 'Karar Kayıtları' },
    { id: 'nav-analytics', label: 'Tasarruf / ROI' },
    { id: 'nav-report',    label: 'Yönetici Raporu' },
  ]},
  { group: 'Yönetim', items: [
    { id: 'nav-admin',       label: 'Kullanıcılar' },
    { id: 'nav-admin-roles', label: 'Roller & Yetkiler' },
    { id: 'nav-logs',        label: 'Loglar' },
  ]},
];

function applyNavPermissions(allowedItems) {
  const allowed = new Set(allowedItems);
  NAV_PERM_GROUPS.forEach(({ items }) => {
    items.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) el.style.display = allowed.has(id) ? '' : 'none';
    });
  });
  // Hide group header if all its children are hidden
  const groupMap = {
    'ara': ['nav-search','nav-compare','nav-filter'],
    'kutuphane': ['nav-db-upload','nav-db','nav-cat','nav-attr-defs','nav-duplicates'],
    'digital': ['nav-contour','nav-scan'],
    'raporlar': ['nav-reports','nav-activity','nav-analytics','nav-report'],
    'yonetim': ['nav-admin','nav-admin-roles','nav-logs'],
  };
  Object.entries(groupMap).forEach(([name, ids]) => {
    const visible = ids.some(id => allowed.has(id));
    const btn = document.getElementById('navGroupBtn-' + name);
    const menu = document.getElementById('navGroup-' + name);
    const grp = btn?.closest('.tab-group');
    if (grp) grp.style.display = visible ? '' : 'none';
  });
}

// ── Tab yönetimi ──────────────────────────────────────────────────────────────
function setActiveNav(el) {
  document.querySelectorAll('.tab.active, .tab-sub.active').forEach(t => t.classList.remove('active'));
  if (!el) return;
  el.classList.add('active');
  const submenu = el.closest('.tab-submenu');
  if (submenu) {
    submenu.classList.add('open');
    const btn = submenu.previousElementSibling;
    if (btn) btn.classList.add('expanded');
  }
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
}

(function() {
  if (localStorage.getItem('sidebar-collapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
})();

function toggleNavGroup(name) {
  const menu = document.getElementById('navGroup-' + name);
  const parent = document.getElementById('navGroupBtn-' + name);
  if (!menu || !parent) return;
  const opening = !menu.classList.contains('open');
  if (opening) {
    document.querySelectorAll('.tab-submenu.open').forEach(m => {
      if (m.id !== 'navGroup-' + name) {
        m.classList.remove('open');
        const btn = m.previousElementSibling;
        if (btn) btn.classList.remove('expanded');
      }
    });
  }
  menu.classList.toggle('open', opening);
  parent.classList.toggle('expanded', opening);
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
  if (name === 'analytics') loadAnalytics();
  if (name === 'activity')   loadActivityLog();
  if (name === 'scan')       scanInit();
  if (name === 'duplicates')    loadDuplicatePage();
  if (name === 'image-editor')  initImageEditor();
  if (name === 'admin')         initAdminPage();
  if (name === 'decisions')     initPageDecisions();
}

// ── Path routing ──────────────────────────────────────────────────────────────
const _VALID_PAGES = new Set(['search','db','approved','contour','cat','attr-defs','analytics','activity','duplicates','scan','image-editor','admin','reports','decisions']);

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
