//  ARA SAYFASI
// ══════════════════════════════════════════════════════════════════════════════
const searchState = { file: null, results: null, view: 'grid', sort: 'similarity' };
let searchStartInitialHtml = '';
const compareState = { items: [] };

function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag'); }
function handleDragLeave() { document.getElementById('uploadZone').classList.remove('drag'); }
function handleDrop(e) { e.preventDefault(); handleDragLeave(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }
function onFileSelect(e) { if (e.target.files[0]) setFile(e.target.files[0]); }

function setFile(f) {
  searchState.file = f;
  const title = document.getElementById('uploadTitle');
  const sub = document.getElementById('uploadSub');
  const name = document.getElementById('uploadFname');
  const zone = document.getElementById('uploadZone');
  const btn = document.getElementById('searchBtn');
  const note = document.getElementById('searchBtnNote');
  if (title) title.textContent = f.name;
  if (sub) sub.textContent = 'Dosya yüklendi — Arama için hazır';
  if (name) name.textContent = `${(f.size / 1024).toFixed(1)} KB`;
  if (zone) zone.classList.add('loaded');
  if (btn) btn.disabled = false;
  if (note) note.textContent = 'Dosya yüklendi — arama için hazır';
}

function clearSearchFile() {
  searchState.file = null;
  const input = document.getElementById('fileInput');
  const zone = document.getElementById('uploadZone');
  const title = document.getElementById('uploadTitle');
  const sub = document.getElementById('uploadSub');
  const name = document.getElementById('uploadFname');
  const btn = document.getElementById('searchBtn');
  const note = document.getElementById('searchBtnNote');
  const preview = document.getElementById('sidebarPreview');
  if (input) input.value = '';
  if (zone) zone.classList.remove('loaded');
  if (title) title.textContent = 'Dosyayı buraya bırakın';
  if (sub) sub.textContent = 'veya tıklayarak bilgisayarınızdan seçin';
  if (name) name.textContent = '';
  if (btn) btn.disabled = true;
  if (note) note.textContent = 'Arama başlatmak için önce bir dosya yükleyin';
  if (preview) preview.style.display = 'none';
}

function updateSearchThreshold(value) {
  const v = Number(value || 70);
  const label = document.getElementById('minSimVal');
  const slider = document.getElementById('minSimSlider');
  if (label) label.textContent = `%${v}`;
  if (slider) {
    const min = Number(slider.min || 40);
    const max = Number(slider.max || 95);
    const pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    slider.style.background = `linear-gradient(90deg,#2f66eb 0%,#2f66eb ${pct}%,#d5dde8 ${pct}%,#d5dde8 100%)`;
  }
}

function initSearchControls() {
  const slider = document.getElementById('minSimSlider');
  if (slider) updateSearchThreshold(slider.value);
  renderSearchCategoryChips();
}

function setSearchCategory(id) {
  const select = document.getElementById('searchCategorySelect');
  if (select) select.value = id || '';
  renderSearchCategoryChips();
}

function renderSearchCategoryChips() {
  const select = document.getElementById('searchCategorySelect');
  const wrap = document.getElementById('searchCategoryChips');
  if (!select || !wrap) return;
  const current = select.value || '';
  const options = Array.from(select.options).filter(opt => opt.value !== '' || opt.textContent.trim());
  wrap.innerHTML = options.map(opt => {
    const label = opt.value === '' ? 'Tüm Kategoriler' : opt.textContent;
    const active = (opt.value || '') === current ? 'active' : '';
    return `<button type="button" class="search-category-chip ${active}" data-cat-id="${opt.value}" onclick="setSearchCategory('${String(opt.value).replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function searchRoot() {
  return document.getElementById('searchStartShell') || document.getElementById('searchMain');
}

async function doSearch() {
  if (!searchState.file) return;
  const topk = document.getElementById('topkSlider')?.value || 10;
  const minSim = (document.getElementById('minSimSlider')?.value || 70) / 100;
  const catId = document.getElementById('searchCategorySelect')?.value || '';
  const sort = document.getElementById('sortSelect')?.value || 'similarity';
  const main = searchRoot();
  main.innerHTML = `<div class="loading"><div class="spinner"></div><div>${searchState.file.name} analiz ediliyor...</div></div>`;
  try {
    const catParam = catId ? `&category_id=${catId}` : '';
    const fd = new FormData();
    fd.append('file', searchState.file);
    const r = await fetch(`${API}/search?top_k=${topk}&min_similarity=${minSim}${catParam}`, { method: 'POST', headers: authH(), body: fd });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    searchState.sort = sort;
    if (sort === 'entity_count') data.results.sort((a,b) => b.entity_count - a.entity_count);
    else if (sort === 'layer_count') data.results.sort((a,b) => b.layer_count - a.layer_count);
    searchState.results = data;
    renderResults(data);
    loadHistory();
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><div class="empty-icon" style="background:rgba(239,68,68,0.1)"><svg viewBox="0 0 24 24" style="stroke:#ef4444;fill:none;stroke-width:1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-title" style="color:#ef4444">Hata</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function badgeClass(sim) { return sim >= 80 ? 'badge-high' : sim >= 60 ? 'badge-med' : 'badge-low'; }
function simColor(sim) { return sim >= 80 ? '#22c55e' : sim >= 60 ? '#f59e0b' : '#ef4444'; }
function scoreTone(sim) {
  const n = Number(sim) || 0;
  if (n >= 90) return 'score-elite';
  if (n >= 80) return 'score-high';
  if (n >= 60) return 'score-gold';
  return 'score-low';
}

// ───────── NEDEN BENZER? açıklama üreticileri ─────────
function _topKey(obj) {
  let best = null, max = -1;
  for (const [k,v] of Object.entries(obj||{})) {
    const n = Number(v) || 0;
    if (n > max) { max = n; best = k; }
  }
  return best;
}
function _cosineTypes(a, b) {
  const keys = new Set([...Object.keys(a||{}), ...Object.keys(b||{})]);
  if (!keys.size) return null;
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const x = Number((a||{})[k] || 0), y = Number((b||{})[k] || 0);
    dot += x*y; na += x*x; nb += y*y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function _guessPaperFormat(w, h) {
  const a = Math.max(w, h), b = Math.min(w, h);
  if (b <= 0) return null;
  const ratio = a / b;
  if (Math.abs(ratio - 1.414) > 0.07) return null;
  const sizes = [
    {n:'A0', w:1189, h:841}, {n:'A1', w:841, h:594},
    {n:'A2', w:594, h:420},  {n:'A3', w:420, h:297},
    {n:'A4', w:297, h:210},  {n:'A5', w:210, h:148},
  ];
  for (const s of sizes) {
    if (Math.abs(a - s.w) / s.w < 0.15 && Math.abs(b - s.h) / s.h < 0.2) return s.n;
  }
  return 'A-serisi';
}
// queryStats (qs) ile match satırı (r) karşılaştırıp okunabilir gerekçeler üretir
function buildMatchReasons(qs, r) {
  qs = qs || {}; r = r || {};
  const out = []; // { tone: 'strong'|'ok'|'weak', icon, label, value }

  // 0) Hash eşleşmesi (en güçlü sinyal)
  if (r.content_hash && qs.content_hash && r.content_hash === qs.content_hash) {
    out.push({ tone:'strong', icon:'#', label:'Aynı içerik (hash eşleşti)', value:'SHA256 birebir' });
  } else if (r.geometry_hash && qs.geometry_hash && r.geometry_hash === qs.geometry_hash) {
    out.push({ tone:'strong', icon:'#', label:'Aynı geometri hash', value:'Özdeş yapı' });
  }

  // 1) Görsel benzerlik (CLIP — konu/içerik uyumu)
  if (r.clip_similarity != null) {
    const cs = Number(r.clip_similarity);
    const sim = Number(r.similarity) || 0;
    const geoContrib = sim > 0 && cs > 0 ? Math.round((sim - cs * 0.6) / 0.4 * 10) / 10 : null;
    if (cs >= 70) out.push({ tone:'strong', icon:'◉', label:`Görsel içerik çok benzer (CLIP %${cs})`, value: geoContrib != null ? `Geo katkı ~%${geoContrib}` : `%${cs}` });
    else if (cs >= 50) out.push({ tone:'ok', icon:'◉', label:`Kısmi görsel benzerlik (CLIP %${cs})`, value: '' });
    else if (cs < 30) out.push({ tone:'weak', icon:'◌', label:`Görsel uyum düşük (CLIP %${cs})`, value: '' });
  }

  // 2) Dış hat / siluet örtüşmesi
  if (r.visual_similarity != null) {
    if (r.visual_similarity >= 70) out.push({ tone:'strong', icon:'▣', label:'Dış hat örtüşüyor (siluet)', value:`%${r.visual_similarity}` });
    else if (r.visual_similarity >= 50) out.push({ tone:'ok', icon:'▣', label:'Dış hat kısmen örtüşüyor', value:`%${r.visual_similarity}` });
  }

  // 3) En/boy oranı + kağıt formatı + ölçek + bbox boyutları
  const qw = +qs.bbox_width || 0, qh = +qs.bbox_height || 0;
  const cw = +r.bbox_width  || 0, ch = +r.bbox_height  || 0;
  if (qw > 0 && qh > 0 && cw > 0 && ch > 0) {
    out.push({ tone:'ok', icon:'⊡', label:'BBox boyutları', value:`${Math.round(qw)}×${Math.round(qh)} → ${Math.round(cw)}×${Math.round(ch)}` });
    const qAR = qw / qh, cAR = cw / ch;
    const arDiff = Math.abs(Math.log(qAR) - Math.log(cAR));
    if (arDiff < 0.08) out.push({ tone:'strong', icon:'▭', label:'Aynı en/boy oranı', value:`${qAR.toFixed(2)} ≈ ${cAR.toFixed(2)}` });
    else if (arDiff < 0.25) out.push({ tone:'ok', icon:'▭', label:'Yakın en/boy oranı', value:`${qAR.toFixed(2)} / ${cAR.toFixed(2)}` });
    else if (arDiff > 0.6) out.push({ tone:'weak', icon:'▭', label:'En/boy oranı farklı', value:`${qAR.toFixed(2)} ↔ ${cAR.toFixed(2)}` });

    const pf1 = _guessPaperFormat(qw, qh);
    const pf2 = _guessPaperFormat(cw, ch);
    if (pf1 && pf2 && pf1 === pf2) {
      out.push({ tone:'strong', icon:'📄', label:'Aynı kağıt formatı', value: pf1 });
    }

    const qDiag = Math.hypot(qw, qh), cDiag = Math.hypot(cw, ch);
    const scale = Math.min(qDiag, cDiag) / Math.max(qDiag, cDiag);
    if (scale > 0.88)      out.push({ tone:'strong', icon:'⟷', label:'Benzer ölçek',   value:`%${Math.round(scale*100)}` });
    else if (scale < 0.35) out.push({ tone:'weak',   icon:'⟷', label:'Ölçek farkı büyük', value:`%${Math.round(scale*100)}` });
  }

  // 4) Entity sayısı yakınlığı (karmaşıklık)
  const qe = +qs.entity_count || 0, ce = +r.entity_count || 0;
  if (qe > 0 && ce > 0) {
    const ratio = Math.min(qe, ce) / Math.max(qe, ce);
    if (ratio > 0.85)      out.push({ tone:'strong', icon:'◈', label:'Yakın karmaşıklık', value:`${qe.toLocaleString('tr')} ≈ ${ce.toLocaleString('tr')} entity` });
    else if (ratio < 0.35) out.push({ tone:'weak',   icon:'◈', label:'Karmaşıklık farkı büyük', value:`${qe.toLocaleString('tr')} / ${ce.toLocaleString('tr')}` });
  }

  // 5) Katman örtüşmesi
  const qL = (qs.layers || []).map(x => String(x).toLowerCase()).filter(Boolean);
  const cL = (r.layers  || []).map(x => String(x).toLowerCase()).filter(Boolean);
  if (qL.length && cL.length) {
    const qSet = new Set(qL), cSet = new Set(cL);
    const inter = [...qSet].filter(x => cSet.has(x));
    const union = new Set([...qSet, ...cSet]);
    const jaccard = union.size ? inter.length / union.size : 0;
    if (inter.length >= 3 || jaccard >= 0.5) {
      const show = inter.slice(0, 4).join(', ') + (inter.length > 4 ? '…' : '');
      out.push({ tone:'strong', icon:'≡', label:`Ortak katman × ${inter.length}`, value: show });
    } else if (inter.length >= 1) {
      out.push({ tone:'ok', icon:'≡', label:`Bir kısım katman ortak`, value: inter.slice(0,3).join(', ') });
    }
  }

  // 6) Entity tipi bileşimi + dağılım yüzdesi
  const qT = qs.entity_types || {};
  const cT = r.entity_types  || {};
  const qTop = _topKey(qT), cTop = _topKey(cT);
  if (qTop && cTop && qTop === cTop) {
    out.push({ tone:'ok', icon:'▲', label:'Ağırlıklı tip aynı', value: qTop });
  }
  // Top-3 entity dağılımı
  const cTotal = Object.values(cT).reduce((a,b)=>a+b,0);
  if (cTotal > 0) {
    const top3 = Object.entries(cT).sort((a,b)=>b[1]-a[1]).slice(0,3)
      .map(([k,v]) => `${k} %${Math.round(v/cTotal*100)}`).join(' · ');
    out.push({ tone:'ok', icon:'≡', label:'Sonuç entity dağılımı', value: top3 });
  }
  const typeSim = _cosineTypes(qT, cT);
  if (typeSim != null) {
    if (typeSim >= 0.9)      out.push({ tone:'strong', icon:'≈', label:'Entity bileşimi çok benzer', value:`%${Math.round(typeSim*100)}` });
    else if (typeSim >= 0.7) out.push({ tone:'ok', icon:'≈', label:'Benzer entity bileşimi',     value:`%${Math.round(typeSim*100)}` });
    else if (typeSim < 0.4)  out.push({ tone:'weak', icon:'≈', label:'Farklı entity bileşimi',   value:`%${Math.round(typeSim*100)}` });
  }

  // 7) Geometry guard düşükse uyarı
  if (r.geometry_guard != null && r.geometry_guard < 50) {
    out.push({ tone:'weak', icon:'⚠', label:'Boyut + entity uyumu zayıf', value:`%${r.geometry_guard}` });
  }

  // Öncelik sırası: strong > ok > weak
  const order = { strong: 0, ok: 1, weak: 2 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);
  return out;
}
function reasonChipsHtml(reasons, max) {
  if (!reasons || !reasons.length) return '';
  const palette = {
    strong: { bg:'rgba(34,197,94,0.12)',  brd:'rgba(34,197,94,0.45)',  fg:'#16a34a' },
    ok:     { bg:'rgba(245,158,11,0.12)', brd:'rgba(245,158,11,0.45)', fg:'#b45309' },
    weak:   { bg:'rgba(239,68,68,0.12)',  brd:'rgba(239,68,68,0.45)',  fg:'#dc2626' },
  };
  const items = reasons.slice(0, max || reasons.length).map(rs => {
    const p = palette[rs.tone] || palette.ok;
    return `<span class="reason-chip" style="background:${p.bg};border:1px solid ${p.brd};color:${p.fg}" title="${rs.label}${rs.value?': '+rs.value:''}">
      <span class="reason-ico">${rs.icon}</span>
      <span class="reason-lbl">${rs.label}</span>
      ${rs.value ? `<span class="reason-val">${rs.value}</span>` : ''}
    </span>`;
  }).join('');
  return `<div class="reason-chips">${items}</div>`;
}
function reasonListHtml(reasons) {
  if (!reasons || !reasons.length) return '<div class="reason-empty">Ayrıntılı sebep üretilemedi.</div>';
  const palette = {
    strong: { bar:'#16a34a', label:'Güçlü' },
    ok:     { bar:'#f59e0b', label:'Kısmi' },
    weak:   { bar:'#ef4444', label:'Zayıf' },
  };
  return `<ul class="reason-list">${reasons.map(rs => {
    const p = palette[rs.tone] || palette.ok;
    return `<li>
      <span class="reason-dot" style="background:${p.bar}"></span>
      <span class="reason-row-label">${rs.icon} ${rs.label}</span>
      ${rs.value ? `<span class="reason-row-value">${rs.value}</span>` : ''}
      <span class="reason-row-tone" style="color:${p.bar}">${p.label}</span>
    </li>`;
  }).join('')}</ul>`;
}

function resetSearchPage() {
  const shell = document.getElementById('searchStartShell');
  if (!shell || !searchStartInitialHtml) return;
  shell.innerHTML = searchStartInitialHtml;
  searchState.file = null;
  searchState.results = null;
  searchState.view = 'grid';
  searchState.sort = 'similarity';
  loadCategoriesIntoSelect();
  loadHistory();
  setTimeout(initSearchControls, 0);
}

function toggleResultFilter() {
  const bar = document.getElementById('resultFilterBar');
  const btn = document.getElementById('filterToggleBtn');
  if (!bar) return;
  const open = bar.style.display === 'flex';
  bar.style.display = open ? 'none' : 'flex';
  if (btn) btn.style.background = open ? '' : '#eff5ff';
}

function applyResultFilters() {
  const data = searchState.results;
  if (!data) return;
  const cat = document.getElementById('rFilterCat')?.value || '';
  const kind = document.getElementById('rFilterKind')?.value || '';
  const minSim = Number(document.getElementById('rFilterSim')?.value || 0);
  const kindRanges = { elite: [95,100], high: [80,94.9], gold: [65,79.9], low: [0,64.9] };
  const filtered = { ...data, results: data.results.filter(r => {
    if (cat && r.category_name !== cat) return false;
    if (minSim && r.similarity < minSim) return false;
    if (kind) {
      const [lo, hi] = kindRanges[kind] || [0, 100];
      if (r.similarity < lo || r.similarity > hi) return false;
    }
    return true;
  })};
  filtered.total_matches = filtered.results.length;
  renderResults(filtered);
  const bar = document.getElementById('resultFilterBar');
  if (bar) { bar.style.display = 'flex'; }
}

function clearResultFilters() {
  const cat = document.getElementById('rFilterCat');
  const kind = document.getElementById('rFilterKind');
  const sim = document.getElementById('rFilterSim');
  if (cat) cat.value = '';
  if (kind) kind.value = '';
  if (sim) sim.value = '0';
  applyResultFilters();
}

function searchMatchKind(sim, index) {
  const n = Number(sim) || 0;
  if (index === 0 && n >= 88) return 'Tam Eşleşme';
  if (n >= 78) return 'Muadil';
  if (n >= 60) return 'Benzer';
  return 'Revizyon Adayı';
}

function searchResultSummary(results) {
  return results.reduce((acc, r, i) => {
    const kind = searchMatchKind(r.similarity, i);
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
}

function renderFigmaResultPreview(r) {
  if (r.jpg_preview) {
    return `<img src="${r.jpg_preview}" alt="${escHtml(r.filename)} önizleme">`;
  }
  if (r.svg_preview) return r.svg_preview;
  return `<canvas id="canvas_${r.id}" width="270" height="270" style="width:100%;height:100%;display:block"></canvas>`;
}

function renderFigmaResultCard(r, index) {
  const qs = (searchState.results && searchState.results.query_stats) || {};
  const reasons = buildMatchReasons(qs, r);
  const tone = scoreTone(r.similarity);
  const kind = searchMatchKind(r.similarity, index);
  const cmpActive = compareState.items.some(c => c.id === r.id);
  const bestStrip = index === 0
    ? `<div class="figma-best-strip">★ En iyi eşleşme — Doğrudan kullanılabilir</div>`
    : '';
  const reasonBlock = reasons.length
    ? reasonChipsHtml(reasons, 3)
    : '<span class="reason-empty">Ayrıntılı sebep üretilemedi.</span>';
  return `<article class="figma-result-card ${tone} ${cmpActive ? 'selected' : ''}" onclick="openResultCard(${r.id})" data-result-id="${r.id}">
    ${bestStrip}
    <div class="figma-result-inner">
      <div class="figma-check"></div>
      <div class="figma-result-preview">${renderFigmaResultPreview(r)}</div>
      <div class="figma-result-main">
        <div class="figma-result-title-row">
          <div class="figma-result-title" title="${escHtml(r.filename)}">${escHtml(r.filename)}</div>
          <span class="figma-match-type">${kind}</span>
          <span class="soft-tag">${escHtml(String(r.file_format || 'DWG').toUpperCase())}</span>
          <span class="soft-tag" style="background:#effdf4;color:#16a34a">Aktif</span>
        </div>
        <div class="figma-result-sub">${escHtml(r.category_name || 'Profil Eşleşmesi')}</div>
        <div class="figma-result-meta">
          ${escHtml(r.category_name || 'Kütüphane')} · ${Number(r.bbox_width || 0).toFixed(0)}×${Number(r.bbox_height || 0).toFixed(0)} mm · ${Number(r.entity_count || 0).toLocaleString('tr')} entity · ${Number(r.layer_count || 0)} katman
        </div>
        <div class="figma-reasons-box">
          <div class="figma-reasons-title">ⓘ Neden benzer?</div>
          ${reasonBlock}
        </div>
      </div>
      <div class="figma-score-box">
        <b>%${Number(r.similarity || 0).toFixed(0)}</b>
        <span>benzerlik</span>
      </div>
      <div class="figma-result-actions" onclick="event.stopPropagation()">
        <button class="figma-btn primary" onclick="toggleCompare(${r.id})">${cmpActive ? '✓ Seçildi' : '⌘ Karşılaştır'}</button>
        <button class="figma-btn" style="color:#10b981;border-color:rgba(16,185,129,0.4)" onclick="openDiffModal(${r.id})">◐ Fark</button>
        <button class="figma-btn btn-3d" onclick="showDetailModal(${r.id},'model3d')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> 3D Gör</button>
        <button class="figma-btn success" id="qd-btn-${r.id}" onclick="openQuickDecision(${r.id},this)">☑ Karar Ver</button>
        ${favoriteButton(r, 'figma-btn icon-only')}
      </div>
    </div>
  </article>`;
}

// ── Hızlı Karar Dropdown ─────────────────────────────────────────────────────

const _QD_OPTS = [
  { type: 'usable',     icon: '✓', label: 'Kullanılabilir',  color: '#16a34a' },
  { type: 'substitute', icon: 'ℹ', label: 'Muadil',          color: '#2563eb' },
  { type: 'reject',     icon: '✕', label: 'Uygun Değil',     color: '#dc2626' },
];

function openQuickDecision(resultId, btn) {
  // Varsa aynı dropdown'ı kapat
  const existing = document.getElementById('qdDropdown');
  if (existing) {
    if (existing.dataset.rid === String(resultId)) { existing.remove(); return; }
    existing.remove();
  }

  const data = searchState.results;
  if (!data) return;
  const r = (data.results || []).find(x => x.id === resultId);
  if (!r) return;

  const drop = document.createElement('div');
  drop.id = 'qdDropdown';
  drop.dataset.rid = resultId;
  drop.className = 'qd-drop';
  drop.innerHTML = _QD_OPTS.map(o => `
    <button class="qd-opt" onclick="saveQuickDecision(${resultId},'${o.type}','${o.label}',this)"
            style="--qd-color:${o.color}">
      <span class="qd-opt-icon">${o.icon}</span>${o.label}
    </button>`).join('');

  // Kapat: dışarı tıklanınca
  const onOut = e => { if (!drop.contains(e.target) && e.target !== btn) { drop.remove(); document.removeEventListener('click', onOut, true); } };
  setTimeout(() => document.addEventListener('click', onOut, true), 0);

  // Butona göre konumlandır
  btn.insertAdjacentElement('afterend', drop);
}

async function saveQuickDecision(resultId, type, label, optBtn) {
  const data = searchState.results;
  if (!data) return;
  const r = (data.results || []).find(x => x.id === resultId);
  if (!r) return;

  optBtn.disabled = true;
  optBtn.textContent = '…';

  try {
    const res = await fetch(`${API}/decisions`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_filename: data.query_file || 'Aranan Dosya',
        compared_file_id:   r.id,
        compared_filename:  r.filename,
        similarity_score:   Number(r.similarity || 0),
        decision_type:      type,
        decision_label:     label,
        notes:              null,
      }),
    });
    if (!res.ok) throw new Error(res.status);

    // Dropdown kapat, butonu güncelle
    document.getElementById('qdDropdown')?.remove();
    const cardBtn = document.getElementById(`qd-btn-${resultId}`);
    if (cardBtn) {
      cardBtn.textContent = '✓ ' + label;
      cardBtn.style.cssText = 'color:#16a34a;border-color:rgba(34,197,94,0.5);cursor:default';
      cardBtn.onclick = null;
    }
  } catch (e) {
    optBtn.disabled = false;
    optBtn.textContent = 'Hata!';
    setTimeout(() => { optBtn.textContent = _QD_OPTS.find(o => o.type === type)?.label || label; optBtn.disabled = false; }, 1500);
  }
}

function sortSearchResultsBy(value) {
  const data = searchState.results;
  if (!data || !data.results) return;
  if (value === 'entity_count') data.results.sort((a, b) => (b.entity_count || 0) - (a.entity_count || 0));
  else if (value === 'layer_count') data.results.sort((a, b) => (b.layer_count || 0) - (a.layer_count || 0));
  else data.results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  searchState.sort = value;
  const hiddenSort = document.getElementById('sortSelect');
  if (hiddenSort) hiddenSort.value = value;
  renderResults(data);
}

function renderResults(data) {
  const main = searchRoot();
  if (!data.results.length) {
    const minSim = document.getElementById('minSimSlider')?.value || 70;
    main.innerHTML = `<div class="search-results-shell"><button class="search-back-btn" onclick="resetSearchPage()"><svg viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg></button><div class="empty-state"><div class="empty-title">Sonuç bulunamadı</div><div class="empty-sub">Benzerlik eşiği şu an %${minSim}. Eşiği düşürüp tekrar deneyebilirsiniz.</div></div></div>`;
    return;
  }

  const qs = data.query_stats || {};
  const queryFormat = String(
    qs.file_format ||
    ((data.query_file || '').includes('.') ? data.query_file.split('.').pop() : '') ||
    'DWG'
  ).toUpperCase();
  const queryPreviewHtml = data.query_preview
    ? `<img src="${data.query_preview}" alt="Aranan dosya görseli">`
    : `<div class="query-preview-fallback">Önizleme üretilemedi</div>`;
  const selectedCategory = document.getElementById('searchCategorySelect')?.selectedOptions?.[0]?.textContent || 'Tüm Kategoriler';
  const threshold = document.getElementById('minSimSlider')?.value || 70;
  const currentSort = document.getElementById('sortSelect')?.value || searchState.sort || 'similarity';
  const summary = searchResultSummary(data.results);
  const summaryRows = [
    ['Tam Eşleşme', '#16a34a'],
    ['Muadil', '#2f66eb'],
    ['Benzer', '#ea580c'],
    ['Revizyon Adayı', '#e11d48'],
  ].map(([label, color]) => `<div class="summary-row"><span><i class="summary-dot" style="background:${color}"></i>${label}</span><strong style="color:${color}">${summary[label] || 0}</strong></div>`).join('');

  main.innerHTML = `
    <div class="search-results-shell">
      <div class="search-results-top">
        <div class="search-results-title-row">
          <button class="search-back-btn" onclick="resetSearchPage()" aria-label="Arama ekranına dön">
            <svg viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
          <div class="search-results-head">
            <h1>Arama Sonuçları</h1>
            <div class="search-results-sub"><b style="color:#2f66eb">${data.total_matches} sonuç</b> bulundu · %${threshold}+ benzerlik eşiği · ${escHtml(selectedCategory)}</div>
          </div>
        </div>
        <div class="search-results-actions">
          <span>Sırala:</span>
          <select class="search-sort-select" onchange="sortSearchResultsBy(this.value)">
            <option value="similarity" ${currentSort === 'similarity' ? 'selected' : ''}>Benzerlik Skoru</option>
            <option value="entity_count" ${currentSort === 'entity_count' ? 'selected' : ''}>Entity sayısı</option>
            <option value="layer_count" ${currentSort === 'layer_count' ? 'selected' : ''}>Katman sayısı</option>
          </select>
          <button class="search-action-btn" id="filterToggleBtn" onclick="toggleResultFilter()">⊟ Filtrele</button>
          <button class="search-action-btn primary" onclick="alert('Rapor hazırlama yakında aktif olacak.')">⇩ Rapor İndir</button>
        </div>
      </div>

      <div id="resultFilterBar" style="display:none;background:#fff;border:1px solid #dbe5f0;border-radius:10px;padding:12px 16px;margin-bottom:12px;display:none;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#334155">
          <span>Kategori:</span>
          <select id="rFilterCat" onchange="applyResultFilters()" style="height:28px;border:1px solid #dbe5f0;border-radius:6px;padding:0 8px;font-size:12px;min-width:140px">
            <option value="">Tümü</option>
            ${[...new Set(data.results.map(r => r.category_name).filter(Boolean))].map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#334155">
          <span>Eşleşme tipi:</span>
          <select id="rFilterKind" onchange="applyResultFilters()" style="height:28px;border:1px solid #dbe5f0;border-radius:6px;padding:0 8px;font-size:12px;min-width:140px">
            <option value="">Tümü</option>
            <option value="elite">Tam Eşleşme (≥95%)</option>
            <option value="high">Muadil (≥80%)</option>
            <option value="gold">Benzer (≥65%)</option>
            <option value="low">Revizyon Adayı (&lt;65%)</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#334155">
          <span>Min. benzerlik:</span>
          <input id="rFilterSim" type="number" min="0" max="100" value="0" onchange="applyResultFilters()" style="height:28px;width:64px;border:1px solid #dbe5f0;border-radius:6px;padding:0 8px;font-size:12px">
          <span style="color:#94a3b8">%</span>
        </div>
        <button onclick="clearResultFilters()" style="height:28px;border:1px solid #fecaca;border-radius:6px;background:#fff5f5;color:#dc2626;font-size:12px;font-weight:700;padding:0 12px;cursor:pointer">✕ Temizle</button>
      </div>

      <div class="search-results-grid">
        <aside class="search-results-left">
          <div class="search-card query-side-card">
            <div class="query-side-title">Aranan Dosya</div>
            <div class="query-side-preview">${queryPreviewHtml}</div>
            <div class="query-side-name" title="${escHtml(data.query_file)}">${escHtml(data.query_file)}</div>
            <div class="query-side-sub">Yeni Yüklenen Profil</div>
            <div class="query-side-tags"><span class="soft-tag">${queryFormat}</span><span class="soft-tag">${(searchState.file?.size ? (searchState.file.size / 1024 / 1024).toFixed(1) : '0.0')} MB</span></div>
          </div>
          <div class="search-card summary-card">
            <div class="summary-title">Sonuç Özeti</div>
            ${summaryRows}
          </div>
        </aside>

        <div class="search-results-list">
          ${data.results.map((r, i) => renderFigmaResultCard(r, i)).join('')}
        </div>
      </div>
    </div>`;

  data.results.forEach(r => {
    const c = document.getElementById('canvas_' + r.id);
    if (c) setTimeout(() => drawPreview(c, r), 30);
  });
}

function renderGridCard(r) {
  const chips = (r.layers||[]).slice(0,4).map(l=>`<span class="layer-chip">${l}</span>`).join('');
  const catBadge = r.category_name
    ? `<span style="background:${r.category_color||'#6366f1'}22;color:${r.category_color||'#6366f1'};border:1px solid ${r.category_color||'#6366f1'}55;font-size:10px;font-weight:600;padding:1px 7px;border-radius:20px">${r.category_name}</span>`
    : '';
  const cmpActive = compareState.items.some(c => c.id === r.id);
  const previewHtml = r.jpg_preview
    ? `<img src="${r.jpg_preview}" style="width:100%;height:270px;object-fit:contain;background:#ffffff;display:block;padding:16px;filter:contrast(1.7) brightness(1.14)">`
    : (r.svg_preview
      ? `<div style="width:100%;height:270px;display:flex;align-items:center;justify-content:center;background:#ffffff;overflow:hidden;padding:16px">${r.svg_preview}</div>`
      : `<canvas id="canvas_${r.id}" width="236" height="128" style="opacity:0.8"></canvas>`);
  const qs = (searchState.results && searchState.results.query_stats) || {};
  const reasons = buildMatchReasons(qs, r);
  const reasonBlock = reasons.length
    ? `<div class="reason-section-title">Neden benzer?</div>${reasonChipsHtml(reasons, 3)}
       ${reasons.length > 3 ? `<button class="reason-toggle-btn" onclick="event.stopPropagation();openReasonModal(${r.id})">+${reasons.length - 3} neden daha</button>` : ''}`
    : '';
  const tone = scoreTone(r.similarity);
  return `<div class="result-card ${tone} ${cmpActive?'selected':''}" onclick="openResultCard(${r.id})" data-result-id="${r.id}">
    <div class="card-preview">
      ${previewHtml}
      <div class="card-badge ${badgeClass(r.similarity)}">${r.similarity}%</div>
    </div>
    <div class="card-body">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <div class="card-name" title="${r.filename}" style="margin-bottom:0;flex:1">${r.filename}</div>
        ${catBadge}
      </div>
      <div class="card-path">${r.filepath}</div>
      <div class="card-stats">
        <div class="cstat">Entity: <span>${r.entity_count.toLocaleString('tr')}</span></div>
        <div class="cstat">Katman: <span>${r.layer_count}</span></div>
        <div class="cstat">Format: <span>${r.file_format.toUpperCase()}</span></div>
      </div>
      ${chips ? `<div class="layer-chips">${chips}</div>` : ''}
      <div class="sim-bar-wrap">
        <div class="sim-bar-label"><span>Benzerlik</span><span>${r.similarity}%</span></div>
        <div class="sim-bar"><div class="sim-fill" style="width:${r.similarity}%;background:${simColor(r.similarity)}"></div></div>
      </div>
      ${reasonBlock}
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap" onclick="event.stopPropagation()">
        ${favoriteButton(r)}
        <button class="cmp-btn ${cmpActive?'active':''}" onclick="toggleCompare(${r.id})">${cmpActive?'✓ Seçildi':'+ Karşılaştır'}</button>
        ${compareState.items.length===2&&compareState.items.every(c=>c)?`<button class="cmp-btn" style="border-color:var(--amber);color:var(--amber)" onclick="openCompareModal()">Karşılaştır →</button>`:''}
        <button class="cmp-btn" style="border-color:rgba(16,185,129,0.5);color:#10b981" onclick="openDiffModal(${r.id})" title="Aranan dosya ile farkı yeşil/kırmızı göster">◐ Fark</button>
        <button class="cmp-btn" style="border-color:rgba(59,130,246,0.4);color:var(--blue)" onclick="downloadFile(${r.id},'${r.filename.replace(/'/g,"\\'")}','${r.file_format||'dwg'}')">↓ İndir</button>
        <button class="cmp-btn" id="fb-up-${r.id}" style="border-color:rgba(34,197,94,0.4);color:#16a34a" onclick="sendSearchFeedback(${r.id},${r.similarity},true,'up-${r.id}')" title="Bu sonuç doğru">👍</button>
        <button class="cmp-btn" id="fb-dn-${r.id}" style="border-color:rgba(239,68,68,0.4);color:#dc2626" onclick="sendSearchFeedback(${r.id},${r.similarity},false,'dn-${r.id}')" title="Bu sonuç yanlış">👎</button>
      </div>
    </div>
  </div>`;
}

function renderListCard(r, i) {
  const cmpActive = compareState.items.some(c => c.id === r.id);
  const qs = (searchState.results && searchState.results.query_stats) || {};
  const reasons = buildMatchReasons(qs, r);
  const reasonMini = reasons.length
    ? `<div class="list-reason" onclick="event.stopPropagation();openReasonModal(${r.id})" title="Tüm nedenleri gör">${reasonChipsHtml(reasons, 2)}</div>`
    : '';
  const tone = scoreTone(r.similarity);
  return `<div class="result-list-card ${tone} ${cmpActive?'selected':''}" onclick="openResultCard(${r.id})" data-result-id="${r.id}">
    <div class="list-rank">#${i+1}</div>
    <div class="list-info">
      <div class="list-name">${r.filename}</div>
      <div class="list-path">${r.filepath}</div>
      ${reasonMini}
    </div>
    <div class="list-stats">
      <div class="lstat"><div class="lstat-val">${r.entity_count.toLocaleString('tr')}</div><div class="lstat-lbl">entity</div></div>
      <div class="lstat"><div class="lstat-val">${r.layer_count}</div><div class="lstat-lbl">katman</div></div>
      <div class="lstat"><div class="lstat-val">${r.file_format.toUpperCase()}</div><div class="lstat-lbl">format</div></div>
    </div>
    <div class="sim-pill ${badgeClass(r.similarity)}">${r.similarity}%</div>
    ${favoriteButton(r)}
    <button class="cmp-btn ${cmpActive?'active':''}" onclick="event.stopPropagation();toggleCompare(${r.id})">${cmpActive?'✓':'+ Kıyas'}</button>
    <button class="cmp-btn" style="border-color:rgba(16,185,129,0.5);color:#10b981" onclick="event.stopPropagation();openDiffModal(${r.id})" title="Fark">◐ Fark</button>
  </div>`;
}

function setView(v) { searchState.view = v; if (searchState.results) renderResults(searchState.results); }
function selectCard(id) {
  document.querySelectorAll('.result-card,.result-list-card').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`[data-result-id="${id}"]`);
  if (el) el.classList.add('selected');
}
function openResultCard(id) {
  selectCard(id);
  showDetailModal(id);
}

function drawPreview(canvas, result) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const types = result.entity_types || {};
  const seed = result.id * 7919;
  const rng = n => { let x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.6;
  for (let i = 0; i < Math.min(types.LINE || 0, 40); i++) {
    ctx.beginPath(); ctx.moveTo(rng(i)*w, rng(i+0.3)*h); ctx.lineTo(rng(i+0.6)*w, rng(i+0.9)*h); ctx.stroke();
  }
  ctx.strokeStyle = '#60a5fa';
  for (let i = 0; i < Math.min(types.CIRCLE || 0, 15); i++) {
    ctx.beginPath(); ctx.arc(rng(i+1)*w, rng(i+1.3)*h, 3 + rng(i+1.6)*12, 0, Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function searchSetTab(tab) {
  const isUpload = tab === 'upload';
  const isCode = tab === 'code';
  const isAttr = tab === 'attr';

  document.getElementById('stabUpload')?.classList.toggle('active', isUpload);
  document.getElementById('stabCode')?.classList.toggle('active', isCode);
  document.getElementById('stabAttr')?.classList.toggle('active', isAttr);

  const uploadZone = document.getElementById('uploadZone');
  if (uploadZone) uploadZone.style.display = isUpload ? '' : 'none';

  const preview = document.getElementById('sidebarPreview');
  if (preview && !isUpload) preview.style.display = 'none';

  const bottomRow = document.getElementById('searchBottomRow');
  if (bottomRow) bottomRow.style.display = isAttr ? 'none' : '';

  const settingsCard = document.querySelector('#page-search .search-settings-card');
  if (settingsCard) settingsCard.style.display = isUpload ? '' : 'none';

  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) searchBtn.style.display = isUpload ? '' : 'none';

  const searchBtnNote = document.getElementById('searchBtnNote');
  if (searchBtnNote) searchBtnNote.style.display = isUpload ? '' : 'none';

  const codePanel = document.getElementById('searchCodePanel');
  if (codePanel) codePanel.style.display = isCode ? '' : 'none';

  const attrPanel = document.getElementById('searchAttrPanel');
  if (attrPanel) attrPanel.style.display = isAttr ? '' : 'none';

  if (isAttr) loadAttrSearchFilters();
}

async function doCodeSearch() {
  const input = document.getElementById('codeSearchInput');
  const q = input ? input.value.trim() : '';
  if (!q) return;

  const status = document.getElementById('codeSearchStatus');
  const grid = document.getElementById('codeSearchResults');
  if (status) status.textContent = 'Aranıyor...';
  if (grid) grid.innerHTML = '';

  try {
    const r = await fetch(`${API}/files?search=${encodeURIComponent(q)}&per_page=30`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const d = await r.json();
    const files = Array.isArray(d) ? d : (d.files || d.items || []);

    if (!files.length) {
      if (status) status.textContent = `"${q}" için sonuç bulunamadı`;
      return;
    }
    if (status) status.textContent = `${files.length} sonuç bulundu`;
    if (grid) grid.innerHTML = files.map(f => `
      <div class="code-result-card" onclick="openDetailModal && openDetailModal(${f.id})">
        <div class="crc-name">${f.filename}</div>
        <div class="crc-meta">${f.entity_count || 0} entity · ${f.layer_count || 0} katman</div>
        <span class="crc-fmt">${(f.file_format || 'DXF').toUpperCase()}</span>
      </div>
    `).join('');
  } catch {
    if (status) status.textContent = 'Hata oluştu';
  }
}

async function loadSearchHeroStats() {
  try {
    const r = await fetch(`${API}/stats`, { headers: authH() });
    if (!r.ok) return;
    const d = await r.json();
    const el = document.getElementById('heroStatFiles');
    if (el) el.textContent = Number(d.total_files || 0).toLocaleString('tr-TR');
  } catch {}
  try {
    const r2 = await fetch(`${API}/admin/stats`, { headers: authH() });
    if (!r2.ok) return;
    const d2 = await r2.json();
    const el2 = document.getElementById('heroStatMonth');
    if (el2) el2.textContent = Number(d2.monthly_ops || 0).toLocaleString('tr-TR');
  } catch {}
}

