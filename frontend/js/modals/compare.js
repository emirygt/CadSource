// ══════════════════════════════════════════════════════════════════════════════
//  2.11 — KARŞILAŞTIRMA ÇALIŞMA ALANI
// ══════════════════════════════════════════════════════════════════════════════

// ── Seçim yönetimi ──────────────────────────────────────────────────────────

function toggleCompare(id) {
  const results = searchState.results?.results || [];
  const item = results.find(r => r.id === id);
  if (!item) return;

  const idx = compareState.items.findIndex(c => c.id === id);
  if (idx >= 0) {
    compareState.items.splice(idx, 1);
  } else {
    if (compareState.items.length >= 2) compareState.items.shift();
    compareState.items.push(item);
  }

  if (searchState.results) renderResults(searchState.results);
  if (compareState.items.length >= 1) showCompareToast();
  else clearCompare();
}

function showCompareToast() {
  let toast = document.getElementById('compareToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'compareToast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 20px;display:flex;align-items:center;gap:12px;z-index:200;font-size:13px;box-shadow:0 4px 24px rgba(0,0,0,0.12)';
    document.body.appendChild(toast);
  }
  const n = compareState.items.length;
  const label = n === 1 ? '1 dosya seçildi' : '2 dosya seçildi';
  toast.innerHTML = `
    <span style="color:#374151;font-weight:500">${label}</span>
    <button onclick="openCompareModal()" style="background:#1d4ed8;color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer">Karşılaştır →</button>
    <button onclick="clearCompare()" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;padding:0 2px">×</button>`;
  toast.style.display = 'flex';
}

function clearCompare() {
  compareState.items = [];
  const toast = document.getElementById('compareToast');
  if (toast) toast.style.display = 'none';
  if (searchState.results) renderResults(searchState.results);
}

// ── Workspace state ──────────────────────────────────────────────────────────

const cwkState = {
  mode: 'overlay',   // overlay | side | onlyA | onlyB | diff
  refData: null,     // { name, stats, preview }
  cmpItem: null,     // search result item
  decision: null,
};

// ── Open / Close ─────────────────────────────────────────────────────────────

function openCompareModal() {
  if (compareState.items.length < 1) return;

  const queryData  = searchState.results || {};
  const queryStats = queryData.query_stats || {};
  const queryFile  = queryData.query_file || 'Aranan Dosya';
  const queryPreview = queryData.query_preview || null;

  cwkState.refData = { name: queryFile, stats: queryStats, preview: queryPreview };
  cwkState.cmpItem = compareState.items[0];
  cwkState.decision = null;
  cwkState.mode = 'overlay';

  // Populate workspace
  cwkPopulateLeft();
  cwkPopulateRight();

  // Set active tab
  document.querySelectorAll('.cwk-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === 'overlay'));

  // Show
  document.getElementById('compareModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Init canvas (async image load)
  cwkInitCanvas();
}

function closeCompareModal() {
  document.getElementById('compareModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Left sidebar ─────────────────────────────────────────────────────────────

function cwkPopulateLeft() {
  const ref  = cwkState.refData;
  const cmp  = cwkState.cmpItem;
  const qs   = ref.stats;

  // Subtitle
  const refShort = ref.name.replace(/\.[^.]+$/, '').slice(0, 20);
  const cmpShort = cmp.filename.replace(/\.[^.]+$/, '').slice(0, 20);
  document.getElementById('cwkSubtitle').textContent = `${refShort} ↔ ${cmpShort}`;
  document.getElementById('cwkFooterFiles').textContent = `${refShort} ↔ ${cmpShort}`;

  // Reference file card
  const refExt = (ref.name.includes('.') ? ref.name.split('.').pop() : 'dosya').toUpperCase();
  document.getElementById('cwkRefName').textContent = ref.name.replace(/\.[^.]+$/, '') || ref.name;
  document.getElementById('cwkRefFmt').textContent = `${refExt} · Arama Referansı`;
  document.getElementById('cwkRefDesc').textContent = 'Yeni Yüklenen Dosya';

  const qW = Number(qs.bbox_width || 0);
  const qH = Number(qs.bbox_height || 0);
  const qArea = Number(qs.bbox_area || (qW * qH) || 0);

  document.getElementById('cwkRefMeta').innerHTML = cwkMetaHtml([
    ['⟷', 'Boyut', qW > 0 && qH > 0 ? `${Math.round(qW)}×${Math.round(qH)} mm` : '—'],
    ['#',  'Entity', Number(qs.entity_count || 0).toLocaleString('tr')],
    ['≡',  'Katman', Number(qs.layer_count || 0)],
    ['⊡',  'Alan',  qArea > 0 ? `${qArea.toLocaleString('tr', {maximumFractionDigits:0})} mm²` : '—'],
  ]);

  // Compare file card
  const cmpExt = (cmp.file_format || 'dwg').toUpperCase();
  const cmpSizeMb = cmp.file_size ? (cmp.file_size / 1048576).toFixed(1) : null;
  document.getElementById('cwkCmpName').textContent = cmp.filename.replace(/\.[^.]+$/, '') || cmp.filename;
  document.getElementById('cwkCmpFmt').textContent = `${cmpExt}${cmpSizeMb ? ' · ' + cmpSizeMb + ' MB' : ''}`;
  document.getElementById('cwkCmpDesc').textContent = cmp.category_name || '';

  const cW = Number(cmp.bbox_width || 0);
  const cH = Number(cmp.bbox_height || 0);
  const cArea = Number(cmp.bbox_area || (cW * cH) || 0);

  document.getElementById('cwkCmpMeta').innerHTML = cwkMetaHtml([
    ['⟷', 'Boyut', cW > 0 && cH > 0 ? `${Math.round(cW)}×${Math.round(cH)} mm` : '—'],
    ['#',  'Entity', Number(cmp.entity_count || 0).toLocaleString('tr')],
    ['≡',  'Katman', Number(cmp.layer_count || 0)],
    ['⊡',  'Alan',  cArea > 0 ? `${cArea.toLocaleString('tr', {maximumFractionDigits:0})} mm²` : '—'],
  ]);
}

function cwkMetaHtml(rows) {
  return rows.map(([icon, label, val]) => `
    <div class="cwk-meta-row">
      <i class="cwk-meta-icon">${icon}</i>
      <span class="cwk-meta-label">${label}</span>
      <span class="cwk-meta-val">${val}</span>
    </div>`).join('');
}

// ── Right sidebar ─────────────────────────────────────────────────────────────

function cwkPopulateRight() {
  const qs  = cwkState.refData.stats;
  const cmp = cwkState.cmpItem;
  const sim = Number(cmp.similarity || 0);

  // Similarity badge & footer pill
  document.getElementById('cwkSimBadgeVal').textContent = `%${sim}`;
  const pillLabel = sim >= 90 ? 'Tam Eşleşme' : sim >= 70 ? 'Yüksek Benzerlik' : sim >= 50 ? 'Orta Benzerlik' : 'Düşük Benzerlik';
  document.getElementById('cwkFooterPillText').textContent = `%${sim} Benzerlik Skoru — ${pillLabel}`;

  // ── Neden Benzer? metrics (progress bar rows) ──
  const metrics = cwkBuildMetrics(qs, cmp);
  document.getElementById('cwkReasonList').innerHTML = metrics.map(m => `
    <div class="cwk-reason-row">
      <div class="cwk-reason-top">
        <span class="cwk-reason-name">${m.label}</span>
        <span class="cwk-reason-pct">%${m.pct}</span>
      </div>
      <div class="cwk-reason-bar-bg">
        <div class="cwk-reason-bar-fill" style="width:${m.pct}%"></div>
      </div>
    </div>`).join('');

  // ── Fark Özeti ──
  const qE = Number(qs.entity_count || 0);
  const cE = Number(cmp.entity_count || 0);
  const qA = Number(qs.bbox_area || 0);
  const cA = Number(cmp.bbox_area || 0);
  const qW = Number(qs.bbox_width || 0), qH = Number(qs.bbox_height || 0);
  const cW = Number(cmp.bbox_width || 0), cH = Number(cmp.bbox_height || 0);
  const qL = Number(qs.layer_count || 0);
  const cL = Number(cmp.layer_count || 0);

  const diffs = [
    { key: 'Entity farkı',  val: cwkDiffVal(qE, cE, 0, '') },
    { key: 'Alan farkı',    val: cwkDiffVal(qA, cA, 0, ' mm²') },
    { key: 'Boyut farkı',   val: cwkDimDiff(qW, qH, cW, cH) },
    { key: 'Katman farkı',  val: cwkDiffVal(qL, cL, 0, '') },
  ];

  document.getElementById('cwkDiffList').innerHTML = diffs.map(d => `
    <div class="cwk-diff-row">
      <span class="cwk-diff-key">${d.key}</span>
      <span class="cwk-diff-val ${d.val.cls}">${d.val.text}</span>
    </div>`).join('');

  // ── Technical Metrics grid ──
  const pathRef = qs.path_total_length ? `${Number(qs.path_total_length).toFixed(0)} mm` : '—';
  const pathCmp = cmp.path_total_length ? `${Number(cmp.path_total_length).toFixed(0)} mm` : '—';
  const areaRefFmt = qA > 0 ? `${qA.toLocaleString('tr', {maximumFractionDigits:0})} mm²` : '—';
  const areaCmpFmt = cA > 0 ? `${cA.toLocaleString('tr', {maximumFractionDigits:0})} mm²` : '—';
  const dimRefFmt = qW > 0 && qH > 0 ? `${Math.round(qW)}×${Math.round(qH)} mm` : '—';
  const dimCmpFmt = cW > 0 && cH > 0 ? `${Math.round(cW)}×${Math.round(cH)} mm` : '—';

  const dimMatch  = Math.abs(qW - cW) < 1 && Math.abs(qH - cH) < 1;
  const entMatch  = qE > 0 && cE > 0 && Math.abs(qE - cE) / Math.max(qE, cE) < 0.05;
  const layMatch  = qL === cL;
  const pathMatch = pathRef === pathCmp;

  document.getElementById('cwkMetricsGrid').innerHTML = [
    { title: 'Boyut',       ref: `Ref: ${dimRefFmt}`,   cmp: `Sonuç: ${dimCmpFmt}`,  match: dimMatch },
    { title: 'Entity Sayısı', ref: `Ref: ${qE.toLocaleString('tr')}`, cmp: `Sonuç: ${cE.toLocaleString('tr')}`, match: entMatch },
    { title: 'Katman',      ref: `Ref: ${qL}`,           cmp: `Sonuç: ${cL}`,          match: layMatch },
    { title: 'Yol Uzunluğu', ref: `Ref: ${areaRefFmt}`, cmp: `Sonuç: ${areaCmpFmt}`,  match: pathMatch },
  ].map(m => `
    <div class="cwk-metric-card">
      <div class="cwk-metric-title">${m.title}</div>
      <div class="cwk-metric-ref-row">${m.ref}</div>
      <div class="cwk-metric-cmp-row">
        <div class="cwk-metric-dot ${m.match ? 'match' : 'diff'}"></div>
        ${m.cmp}
      </div>
    </div>`).join('');
}

function cwkBuildMetrics(qs, cmp) {
  const out = [];
  const sim = Number(cmp.similarity || 0);

  out.push({ label: 'Geometrik benzerlik', pct: sim });

  if (cmp.visual_similarity != null) {
    out.push({ label: 'Dış hat uyumu', pct: Number(cmp.visual_similarity) });
  }

  if (cmp.clip_similarity != null) {
    out.push({ label: 'Görsel içerik (CLIP)', pct: Number(cmp.clip_similarity) });
  }

  // Layer jaccard
  const qL = (qs.layers || []).map(x => String(x).toLowerCase());
  const cL = (cmp.layers || []).map(x => String(x).toLowerCase());
  if (qL.length && cL.length) {
    const qSet = new Set(qL), cSet = new Set(cL);
    const inter = [...qSet].filter(x => cSet.has(x));
    const union = new Set([...qSet, ...cSet]);
    const jaccard = union.size ? Math.round(inter.length / union.size * 100) : 0;
    out.push({ label: 'Katman yapısı', pct: jaccard });
  } else if (Number(qs.layer_count || 0) === Number(cmp.layer_count || 0) && Number(qs.layer_count || 0) > 0) {
    out.push({ label: 'Katman sayısı', pct: 100 });
  }

  // Entity ratio similarity
  const qE = Number(qs.entity_count || 0), cE = Number(cmp.entity_count || 0);
  if (qE > 0 && cE > 0) {
    const ratio = Math.round(Math.min(qE, cE) / Math.max(qE, cE) * 100);
    out.push({ label: 'Karmaşıklık uyumu', pct: ratio });
  }

  return out.slice(0, 5);
}

function cwkDiffVal(refVal, cmpVal, decimals, unit) {
  if (!refVal && !cmpVal) return { text: '—', cls: '' };
  const diff = refVal - cmpVal;
  if (Math.abs(diff) < 0.5) return { text: 'Yok', cls: 'match' };
  const sign = diff > 0 ? '+' : '';
  return { text: `${sign}${diff.toLocaleString('tr', {maximumFractionDigits: decimals})}${unit}`, cls: 'diff' };
}

function cwkDimDiff(qW, qH, cW, cH) {
  if (!qW || !qH || !cW || !cH) return { text: '—', cls: '' };
  if (Math.abs(qW - cW) < 1 && Math.abs(qH - cH) < 1) return { text: 'Yok', cls: 'match' };
  return { text: `${Math.round(Math.abs(qW - cW))}×${Math.round(Math.abs(qH - cH))} mm`, cls: 'diff' };
}

// ── Canvas rendering ─────────────────────────────────────────────────────────

function cwkInitCanvas() {
  const canvas    = document.getElementById('cwkCanvas');
  const imgRef    = document.getElementById('cwkImgRef');
  const imgCmp    = document.getElementById('cwkImgCmp');
  const loading   = document.getElementById('cwkCanvasLoading');
  const simBadge  = document.getElementById('cwkSimBadge');

  canvas.style.display = 'none';
  loading.style.display = '';
  simBadge.style.display = 'none';

  let refLoaded = false, cmpLoaded = false;

  const tryRender = () => {
    if (!refLoaded || !cmpLoaded) return;
    loading.style.display = 'none';
    canvas.style.display = 'block';
    simBadge.style.display = '';
    cwkRenderCanvas();
  };

  // Reference image
  const refSrc = cwkState.refData.preview;
  if (refSrc) {
    imgRef.onload  = () => { refLoaded = true; tryRender(); };
    imgRef.onerror = () => { refLoaded = true; tryRender(); };
    imgRef.src = refSrc;
    if (imgRef.complete && imgRef.naturalWidth > 0) { refLoaded = true; }
  } else {
    refLoaded = true;
  }

  // Compare image
  const cmpSrc = cwkState.cmpItem.jpg_preview;
  if (cmpSrc) {
    imgCmp.onload  = () => { cmpLoaded = true; tryRender(); };
    imgCmp.onerror = () => { cmpLoaded = true; tryRender(); };
    imgCmp.src = cmpSrc;
    if (imgCmp.complete && imgCmp.naturalWidth > 0) { cmpLoaded = true; }
  } else {
    // Fetch from API
    fetch(`${API}/files/${cwkState.cmpItem.id}`, { headers: authH() })
      .then(r => r.ok ? r.json() : null)
      .then(f => {
        if (f?.jpg_preview) {
          imgCmp.onload  = () => { cmpLoaded = true; tryRender(); };
          imgCmp.onerror = () => { cmpLoaded = true; tryRender(); };
          imgCmp.src = f.jpg_preview;
        } else {
          cmpLoaded = true;
          tryRender();
        }
      })
      .catch(() => { cmpLoaded = true; tryRender(); });
  }

  tryRender();
}

function cwkSetTab(mode) {
  cwkState.mode = mode;
  document.querySelectorAll('.cwk-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === mode));
  // Legend only for diff mode
  const legend = document.getElementById('cwkDiffLegend');
  if (legend) legend.style.display = mode === 'diff' ? '' : 'none';
  cwkRenderCanvas();
}

// Draws an image with object-fit:contain behavior into a region
function cwkDrawContain(ctx, img, x, y, w, h) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  if (!img || !img.naturalWidth) return;
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let dw, dh, dx, dy;
  if (ir > cr) {
    dw = w; dh = w / ir;
    dx = x; dy = y + (h - dh) / 2;
  } else {
    dh = h; dw = h * ir;
    dx = x + (w - dw) / 2; dy = y;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function cwkRenderCanvas() {
  const canvas = document.getElementById('cwkCanvas');
  if (!canvas || canvas.style.display === 'none') return;

  const imgRef = document.getElementById('cwkImgRef');
  const imgCmp = document.getElementById('cwkImgCmp');
  const hasRef = imgRef && imgRef.complete && imgRef.naturalWidth > 0;
  const hasCmp = imgCmp && imgCmp.complete && imgCmp.naturalWidth > 0;

  // Fill the container — read actual dimensions
  const wrap = document.getElementById('cwkCanvasWrap');
  const W = Math.max(200, wrap.clientWidth  - 2);
  const H = Math.max(150, wrap.clientHeight - 2);
  canvas.width  = W;
  canvas.height = H;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  const mode = cwkState.mode;

  if (mode === 'onlyA') {
    cwkDrawContain(ctx, hasRef ? imgRef : null, 0, 0, W, H);
    return;
  }
  if (mode === 'onlyB') {
    cwkDrawContain(ctx, hasCmp ? imgCmp : null, 0, 0, W, H);
    return;
  }
  if (mode === 'side') {
    const half = Math.floor(W / 2);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
    cwkDrawContain(ctx, hasRef ? imgRef : null, 0,      0, half - 1, H);
    cwkDrawContain(ctx, hasCmp ? imgCmp : null, half + 1, 0, W - half - 1, H);
    // divider
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, H); ctx.stroke();
    // labels
    ctx.font = '600 11px DM Sans,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(100,116,139,0.8)';
    ctx.fillText('REFERANS', half / 2, 20);
    ctx.fillText('SONUÇ', half + (W - half) / 2, 20);
    return;
  }

  // Pixel-based modes: overlay & diff
  if (!hasRef && !hasCmp) return;
  const offA = cwkMakeOff(hasRef ? imgRef : null, W, H);
  const offB = cwkMakeOff(hasCmp ? imgCmp : null, W, H);
  let dataA, dataB;
  try {
    dataA = offA.getImageData(0, 0, W, H);
    dataB = offB.getImageData(0, 0, W, H);
  } catch { return; }

  const out = ctx.createImageData(W, H);
  const pa = dataA.data, pb = dataB.data, po = out.data;
  const TH = 180;

  if (mode === 'overlay') {
    // Blue (ref) + Green (cmp) visual overlay
    for (let i = 0; i < pa.length; i += 4) {
      const lumA = 0.299 * pa[i] + 0.587 * pa[i+1] + 0.114 * pa[i+2];
      const lumB = 0.299 * pb[i] + 0.587 * pb[i+1] + 0.114 * pb[i+2];
      const inkA = lumA < TH, inkB = lumB < TH;
      if (inkA && inkB) {
        // Overlap → dark teal
        po[i]=0; po[i+1]=130; po[i+2]=160; po[i+3]=255;
      } else if (inkA) {
        // Ref only → blue
        po[i]=37; po[i+1]=99; po[i+2]=235; po[i+3]=255;
      } else if (inkB) {
        // Cmp only → green
        po[i]=22; po[i+1]=163; po[i+2]=74; po[i+3]=255;
      } else {
        po[i]=252; po[i+1]=252; po[i+2]=252; po[i+3]=255;
      }
    }
  } else {
    // diff mode → green match, red only-ref, blue only-cmp
    for (let i = 0; i < pa.length; i += 4) {
      const lumA = 0.299 * pa[i] + 0.587 * pa[i+1] + 0.114 * pa[i+2];
      const lumB = 0.299 * pb[i] + 0.587 * pb[i+1] + 0.114 * pb[i+2];
      const inkA = lumA < TH, inkB = lumB < TH;
      if (inkA && inkB) {
        po[i]=34; po[i+1]=197; po[i+2]=94; po[i+3]=255;
      } else if (inkA) {
        po[i]=239; po[i+1]=68; po[i+2]=68; po[i+3]=255;
      } else if (inkB) {
        po[i]=59; po[i+1]=130; po[i+2]=246; po[i+3]=255;
      } else {
        po[i]=255; po[i+1]=255; po[i+2]=255; po[i+3]=255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

function cwkMakeOff(img, W, H) {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const cx = off.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H);
  if (img) cx.drawImage(img, 0, 0, W, H);
  return cx;
}

// ── Actions ───────────────────────────────────────────────────────────────────

const CWK_LABELS = {
  usable:     'Mevcut Kalıp Kullanılabilir',
  substitute: 'Muadil Olarak Değerlendir',
  reject:     'Uygun Değil',
};

async function cwkDecision(type, el) {
  // Önceki seçimi temizle
  document.querySelectorAll('.cwk-decision-btn').forEach(b => {
    b.classList.remove('primary', 'cwk-dec-saving', 'cwk-dec-done', 'cwk-dec-err');
    b.disabled = false;
  });

  if (!el) return;
  cwkState.decision = type;
  el.classList.add('primary', 'cwk-dec-saving');
  el.disabled = true;

  try {
    const r = await fetch(`${API}/decisions`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_filename: cwkState.refData.name,
        compared_file_id:   cwkState.cmpItem.id || null,
        compared_filename:  cwkState.cmpItem.filename,
        similarity_score:   Number(cwkState.cmpItem.similarity || 0),
        decision_type:      type,
        decision_label:     CWK_LABELS[type] || type,
        notes:              null,
      }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.status);

    el.classList.remove('cwk-dec-saving');
    el.classList.add('cwk-dec-done');
    el.disabled = false;
    cwkShowDecToast('✓ Karar kaydedildi — ' + (CWK_LABELS[type] || type));

  } catch (e) {
    el.classList.remove('primary', 'cwk-dec-saving');
    el.classList.add('cwk-dec-err');
    el.disabled = false;
    cwkShowDecToast('Hata: ' + e.message, true);
  }
}

function cwkShowDecToast(msg, isErr = false) {
  let t = document.getElementById('cwkDecToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cwkDecToast';
    document.getElementById('compareModal').appendChild(t);
  }
  t.textContent = msg;
  t.className = 'cwk-dec-toast' + (isErr ? ' err' : '');
  t.style.opacity = '1';
  clearTimeout(t._hide);
  t._hide = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

function cwkSaveDecision() {
  // footer "Kararı Kaydet" butonuna basıldığında seçili kararı tekrar kaydet
  const type = cwkState.decision;
  if (!type) { cwkShowDecToast('Önce bir karar seçin.', true); return; }
  const btn = document.querySelector(`.cwk-decision-btn.cwk-dec-done, .cwk-decision-btn.primary`);
  cwkDecision(type, btn);
}

function cwkDownloadPdf() {
  const ref = cwkState.refData;
  const cmp = cwkState.cmpItem;
  if (!ref || !cmp) return;

  const sim  = Number(cmp.similarity || 0);
  const date = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Canvas görüntüsünü yakala
  const cvs = document.getElementById('cwkCanvas');
  const canvasImg = (cvs && cvs.style.display !== 'none') ? cvs.toDataURL('image/png') : null;

  // Ref önizleme
  const refImg = document.getElementById('cwkImgRef');
  const refPreviewSrc = (refImg && refImg.complete && refImg.naturalWidth > 0) ? refImg.src : null;
  const cmpImg = document.getElementById('cwkImgCmp');
  const cmpPreviewSrc = (cmpImg && cmpImg.complete && cmpImg.naturalWidth > 0) ? cmpImg.src : null;

  const qs = ref.stats || {};
  const qW = Number(qs.bbox_width || 0), qH = Number(qs.bbox_height || 0);
  const cW = Number(cmp.bbox_width || 0), cH = Number(cmp.bbox_height || 0);
  const qE = Number(qs.entity_count || 0), cE = Number(cmp.entity_count || 0);
  const qL = Number(qs.layer_count || 0), cL = Number(cmp.layer_count || 0);

  const simColor = sim >= 90 ? '#16a34a' : sim >= 70 ? '#ea580c' : '#dc2626';
  const simLabel = sim >= 90 ? 'Tam Eşleşme' : sim >= 70 ? 'Yüksek Benzerlik' : sim >= 50 ? 'Orta Benzerlik' : 'Düşük Benzerlik';

  const metrics = cwkBuildMetrics(qs, cmp);
  const metricsHtml = metrics.map(m => `
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
        <span style="color:#374151">${m.label}</span>
        <strong style="color:${simColor}">%${m.pct}</strong>
      </div>
      <div style="height:6px;background:#e5e7eb;border-radius:4px">
        <div style="height:100%;width:${m.pct}%;background:${simColor};border-radius:4px"></div>
      </div>
    </div>`).join('');

  const decisionEl = document.querySelector('.cwk-decision-btn.cwk-dec-done, .cwk-decision-btn.primary.cwk-dec-done');
  const decisionText = decisionEl ? decisionEl.textContent.trim() : null;

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>Karşılaştırma Raporu</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111827; background: #fff; font-size: 13px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
  .page { max-width: 800px; margin: 0 auto; padding: 32px 36px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 18px; font-weight: 800; color: #1e293b; letter-spacing: -0.5px; }
  .brand span { color: #2f66eb; }
  .meta { text-align: right; font-size: 11px; color: #6b7280; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 5px; }
  .files-row { display: flex; gap: 14px; }
  .file-card { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .file-card.ref { background: rgba(59,130,246,0.04); border-color: rgba(59,130,246,0.25); }
  .file-card.cmp { background: rgba(34,197,94,0.04); border-color: rgba(34,197,94,0.25); }
  .file-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 5px; }
  .file-card.ref .file-label { color: #1d4ed8; }
  .file-card.cmp .file-label { color: #16a34a; }
  .file-name { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
  .file-meta { font-size: 11px; color: #6b7280; }
  .sim-block { text-align: center; background: linear-gradient(135deg,rgba(${sim>=90?'22,163,74':sim>=70?'234,88,12':'220,38,38'},0.06) 0%,rgba(${sim>=90?'22,163,74':sim>=70?'234,88,12':'220,38,38'},0.12) 100%); border: 1.5px solid rgba(${sim>=90?'22,163,74':sim>=70?'234,88,12':'220,38,38'},0.3); border-radius: 12px; padding: 18px; }
  .sim-pct { font-size: 52px; font-weight: 900; color: ${simColor}; line-height: 1; }
  .sim-label { font-size: 13px; font-weight: 600; color: ${simColor}; margin-top: 4px; }
  .preview-row { display: flex; gap: 12px; }
  .preview-box { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .preview-box img { width: 100%; height: 180px; object-fit: contain; background: #f8fafc; display: block; padding: 8px; }
  .preview-label { font-size: 10px; font-weight: 600; text-align: center; color: #6b7280; padding: 5px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
  .canvas-box { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; text-align: center; }
  .canvas-box img { max-width: 100%; height: auto; display: block; }
  .canvas-label { font-size: 10px; color: #9ca3af; padding: 5px; text-align: center; }
  .metrics-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .diff-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .diff-table td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; }
  .diff-table td:first-child { color: #374151; font-weight: 500; }
  .diff-table td:last-child { text-align: right; font-weight: 700; }
  .td-match { color: #16a34a; }
  .td-diff { color: #ea580c; }
  .decision-box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  .decision-icon { font-size: 20px; }
  .decision-text { font-size: 13px; font-weight: 700; color: #15803d; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }
  .print-btn { position: fixed; top: 20px; right: 20px; background: #2f66eb; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(47,102,235,0.35); }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">⬇ PDF Olarak İndir</button>
<div class="page">

  <div class="header">
    <div>
      <div class="brand">Profile <span>Axis</span></div>
      <div style="font-size:12px;color:#6b7280;margin-top:3px">Karşılaştırma Raporu</div>
    </div>
    <div class="meta">
      <div>${date}</div>
      <div style="margin-top:2px">Profile Axis Enterprise</div>
    </div>
  </div>

  <!-- Dosya bilgileri -->
  <div class="section">
    <div class="section-title">Karşılaştırılan Dosyalar</div>
    <div class="files-row">
      <div class="file-card ref">
        <div class="file-label">Referans (Aranan)</div>
        <div class="file-name">${ref.name || 'Aranan Dosya'}</div>
        <div class="file-meta">
          ${qW > 0 && qH > 0 ? Math.round(qW) + '×' + Math.round(qH) + ' mm · ' : ''}
          ${qE > 0 ? qE.toLocaleString('tr') + ' entity · ' : ''}
          ${qL > 0 ? qL + ' katman' : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;font-size:22px;color:#9ca3af;font-weight:300">↔</div>
      <div class="file-card cmp">
        <div class="file-label">Sonuç (Eşleşen)</div>
        <div class="file-name">${cmp.filename || '—'}</div>
        <div class="file-meta">
          ${cW > 0 && cH > 0 ? Math.round(cW) + '×' + Math.round(cH) + ' mm · ' : ''}
          ${cE > 0 ? cE.toLocaleString('tr') + ' entity · ' : ''}
          ${cL > 0 ? cL + ' katman' : ''}
          ${cmp.category_name ? ' · ' + cmp.category_name : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- Benzerlik skoru -->
  <div class="section">
    <div class="section-title">Benzerlik Skoru</div>
    <div class="sim-block">
      <div class="sim-pct">%${Math.round(sim)}</div>
      <div class="sim-label">${simLabel}</div>
    </div>
  </div>

  ${(refPreviewSrc || cmpPreviewSrc || canvasImg) ? `
  <!-- Görseller -->
  <div class="section">
    <div class="section-title">Görsel Karşılaştırma</div>
    ${(refPreviewSrc || cmpPreviewSrc) ? `
    <div class="preview-row" style="margin-bottom:10px">
      ${refPreviewSrc ? `<div class="preview-box"><img src="${refPreviewSrc}"><div class="preview-label">REFERANS</div></div>` : ''}
      ${cmpPreviewSrc ? `<div class="preview-box"><img src="${cmpPreviewSrc}"><div class="preview-label">SONUÇ</div></div>` : ''}
    </div>` : ''}
    ${canvasImg ? `
    <div class="canvas-box">
      <img src="${canvasImg}">
      <div class="canvas-label">Bindirme Analizi — Mavi: yalnızca referans · Yeşil: yalnızca sonuç · Turkuaz: örtüşen</div>
    </div>` : ''}
  </div>` : ''}

  <!-- Metrikler -->
  <div class="section">
    <div class="metrics-row">
      <div>
        <div class="section-title">Neden Benzer?</div>
        ${metricsHtml}
      </div>
      <div>
        <div class="section-title">Fark Özeti</div>
        <table class="diff-table">
          <tr><td>Entity farkı</td><td class="${Math.abs(qE-cE)===0?'td-match':'td-diff'}">${qE===cE?'Yok':(qE>cE?'+':'')+(qE-cE).toLocaleString('tr')}</td></tr>
          <tr><td>Boyut farkı</td><td class="${(Math.abs(qW-cW)<1&&Math.abs(qH-cH)<1)?'td-match':'td-diff'}">${(Math.abs(qW-cW)<1&&Math.abs(qH-cH)<1)?'Yok':Math.round(Math.abs(qW-cW))+'×'+Math.round(Math.abs(qH-cH))+' mm'}</td></tr>
          <tr><td>Katman farkı</td><td class="${qL===cL?'td-match':'td-diff'}">${qL===cL?'Yok':(qL>cL?'+':'')+(qL-cL)}</td></tr>
          <tr><td>Alan farkı</td><td class="${Math.abs((qs.bbox_area||0)-(cmp.bbox_area||0))<1?'td-match':'td-diff'}">${Math.abs((qs.bbox_area||0)-(cmp.bbox_area||0))<1?'Yok':Math.round(Math.abs((qs.bbox_area||0)-(cmp.bbox_area||0))).toLocaleString('tr')+' mm²'}</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${decisionText ? `
  <!-- Karar -->
  <div class="section">
    <div class="section-title">Mühendis Kararı</div>
    <div class="decision-box">
      <div class="decision-icon">✓</div>
      <div class="decision-text">${decisionText}</div>
    </div>
  </div>` : ''}

  <div class="footer">
    <span>Profile Axis — CAD Benzerlik Arama Motoru</span>
    <span>Bu rapor otomatik oluşturulmuştur.</span>
  </div>

</div>
<script>
  // Yazıcı diyalogu otomatik aç
  window.addEventListener('load', () => setTimeout(() => window.print(), 400));
</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Popup engelleyici açık olabilir. Lütfen izin verin.'); return; }
  win.document.write(html);
  win.document.close();
}

// ── Reason / Diff modals (other callers) ─────────────────────────────────────

function openReasonModal(id) {
  const data = searchState.results;
  if (!data) return;
  const r = (data.results || []).find(x => x.id === id);
  if (!r) return;
  const qs = data.query_stats || {};
  const reasons = buildMatchReasons(qs, r);
  let modal = document.getElementById('reasonModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reasonModal';
    modal.className = 'modal-overlay hidden';
    modal.style.cssText = 'z-index:9000';
    modal.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;max-width:560px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.4px">Neden benzer?</div>
            <div id="reasonModalTitle" style="font-size:14px;font-weight:600;color:var(--text)">—</div>
          </div>
          <button onclick="closeReasonModal()" style="background:transparent;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1">×</button>
        </div>
        <div id="reasonModalBody" style="padding:16px 18px;"></div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) closeReasonModal(); });
    document.body.appendChild(modal);
  }
  document.getElementById('reasonModalTitle').textContent = `${r.filename} · %${r.similarity}`;
  const scoreRow = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;font-size:11.5px">
      <div style="padding:4px 10px;border-radius:6px;background:rgba(59,130,246,0.12);color:#0ea5e9">Final: <b>%${r.similarity}</b></div>
      ${r.clip_similarity != null ? `<div style="padding:4px 10px;border-radius:6px;background:rgba(168,85,247,0.12);color:#a855f7">CLIP görsel: <b>%${r.clip_similarity}</b></div>` : ''}
      ${r.visual_similarity != null ? `<div style="padding:4px 10px;border-radius:6px;background:rgba(16,185,129,0.12);color:#10b981">Siluet (IoU+): <b>%${r.visual_similarity}</b></div>` : ''}
    </div>`;
  document.getElementById('reasonModalBody').innerHTML = scoreRow + reasonListHtml(reasons);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeReasonModal() {
  const modal = document.getElementById('reasonModal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Diff Modal (keep for backward compat) ─────────────────────────────────────

const diffState = {
  mode: 'overlay',
  resultId: null,
  resultRow: null,
  canvas: null,
  imgQ: null,
  imgR: null,
};

function openDiffModal(resultId) {
  const data = searchState.results;
  if (!data || !Array.isArray(data.results)) { alert('Önce bir arama yapmanız gerekiyor.'); return; }
  const row = data.results.find(x => x.id === resultId);
  if (!row) return;
  const queryPreview = data.query_preview;
  if (!queryPreview) { alert('Aranan dosyanın önizlemesi bulunamadı.'); return; }
  if (!row.jpg_preview) { alert('Bu sonucun JPEG önizlemesi yok.'); return; }

  diffState.resultId  = resultId;
  diffState.resultRow = row;
  diffState.mode      = 'overlay';

  document.getElementById('diffModalTitle').textContent =
    `Fark Görünümü — ${data.query_file || 'Aranan'} ↔ ${row.filename}`;

  const body = document.getElementById('diffModalBody');
  body.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <div style="display:flex;gap:6px">
        <button class="cmp-btn diff-mode-btn active" data-mode="overlay" onclick="setDiffMode('overlay')">◐ Bindirme (Fark)</button>
        <button class="cmp-btn diff-mode-btn" data-mode="side"    onclick="setDiffMode('side')">▦ Yan yana</button>
        <button class="cmp-btn diff-mode-btn" data-mode="onlyA"   onclick="setDiffMode('onlyA')">Sadece Aranan</button>
        <button class="cmp-btn diff-mode-btn" data-mode="onlyB"   onclick="setDiffMode('onlyB')">Sadece Sonuç</button>
      </div>
      <div style="flex:1"></div>
      <div style="display:flex;gap:12px;font-size:11px;color:#475569;align-items:center">
        <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px"></span>Eşleşen</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px"></span>Sadece aranan</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:2px;margin-right:4px"></span>Sadece sonuç</span>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:space-around">
      <div style="flex:1;min-width:260px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px;font-weight:600">ARANAN</div>
        <img id="diffImgA" src="${queryPreview}" style="max-width:100%;max-height:260px;border:1px solid #e2e8f0;border-radius:6px;background:#fff">
      </div>
      <div style="flex:1;min-width:260px;text-align:center">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px;font-weight:600">SONUÇ — %${row.similarity}</div>
        <img id="diffImgB" src="${row.jpg_preview}" style="max-width:100%;max-height:260px;border:1px solid #e2e8f0;border-radius:6px;background:#fff">
      </div>
    </div>
    <div style="text-align:center;background:#f1f5f9;padding:12px;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600">FARK HARİTASI</div>
      <canvas id="diffCanvas" width="640" height="480" style="max-width:100%;max-height:520px;background:#fff;border:1px solid #cbd5e1;border-radius:6px"></canvas>
      <div id="diffStats" style="font-size:11px;color:#475569;margin-top:8px"></div>
    </div>`;

  document.getElementById('diffModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const imgA   = document.getElementById('diffImgA');
  const imgB   = document.getElementById('diffImgB');
  const canvas = document.getElementById('diffCanvas');
  diffState.canvas = canvas;

  let loadedA = false, loadedB = false;
  const tryRender = () => { if (loadedA && loadedB) { diffState.imgQ = imgA; diffState.imgR = imgB; renderDiffCanvas(); } };
  if (imgA.complete && imgA.naturalWidth > 0) { loadedA = true; } else { imgA.onload = () => { loadedA = true; tryRender(); }; }
  if (imgB.complete && imgB.naturalWidth > 0) { loadedB = true; } else { imgB.onload = () => { loadedB = true; tryRender(); }; }
  tryRender();
}

function setDiffMode(mode) {
  diffState.mode = mode;
  document.querySelectorAll('.diff-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  renderDiffCanvas();
}

function renderDiffCanvas() {
  const canvas = diffState.canvas;
  const imgA = diffState.imgQ;
  const imgB = diffState.imgR;
  if (!canvas || !imgA || !imgB) return;

  const TARGET_W = 640;
  const ratioA = imgA.naturalHeight / imgA.naturalWidth;
  const ratioB = imgB.naturalHeight / imgB.naturalWidth;
  const ratio  = (ratioA + ratioB) / 2;
  const W = TARGET_W;
  const H = Math.round(W * ratio);
  canvas.width = W; canvas.height = H;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  if (diffState.mode === 'side') {
    const halfW = W / 2;
    ctx.drawImage(imgA, 0, 0, halfW, H);
    ctx.drawImage(imgB, halfW, 0, halfW, H);
    ctx.strokeStyle = '#94a3b8'; ctx.beginPath(); ctx.moveTo(halfW, 0); ctx.lineTo(halfW, H); ctx.stroke();
    document.getElementById('diffStats').textContent = 'Yan yana karşılaştırma';
    return;
  }
  if (diffState.mode === 'onlyA') { ctx.drawImage(imgA, 0, 0, W, H); document.getElementById('diffStats').textContent = 'Sadece aranan dosya'; return; }
  if (diffState.mode === 'onlyB') { ctx.drawImage(imgB, 0, 0, W, H); document.getElementById('diffStats').textContent = 'Sadece sonuç dosyası'; return; }

  const offA = cwkMakeOff(imgA, W, H);
  const offB = cwkMakeOff(imgB, W, H);
  let dataA, dataB;
  try { dataA = offA.getImageData(0,0,W,H); dataB = offB.getImageData(0,0,W,H); } catch(e) { document.getElementById('diffStats').textContent = 'Fark hesaplanamadı: ' + e.message; return; }

  const out = ctx.createImageData(W, H);
  const pa = dataA.data, pb = dataB.data, po = out.data;
  const TH = 180;
  let matchCount = 0, onlyACount = 0, onlyBCount = 0;

  for (let i = 0; i < pa.length; i += 4) {
    const lumA = 0.299*pa[i]+0.587*pa[i+1]+0.114*pa[i+2];
    const lumB = 0.299*pb[i]+0.587*pb[i+1]+0.114*pb[i+2];
    const inkA = lumA < TH, inkB = lumB < TH;
    if (inkA && inkB) { po[i]=34;po[i+1]=197;po[i+2]=94;po[i+3]=255; matchCount++; }
    else if (inkA)    { po[i]=239;po[i+1]=68;po[i+2]=68;po[i+3]=255; onlyACount++; }
    else if (inkB)    { po[i]=59;po[i+1]=130;po[i+2]=246;po[i+3]=255; onlyBCount++; }
    else              { po[i]=255;po[i+1]=255;po[i+2]=255;po[i+3]=255; }
  }
  ctx.putImageData(out, 0, 0);

  const total = matchCount + onlyACount + onlyBCount;
  const pct = n => total > 0 ? ((n/total)*100).toFixed(1) : '0';
  document.getElementById('diffStats').innerHTML =
    `Eşleşen: <b style="color:#22c55e">%${pct(matchCount)}</b> · Sadece aranan: <b style="color:#ef4444">%${pct(onlyACount)}</b> · Sadece sonuç: <b style="color:#3b82f6">%${pct(onlyBCount)}</b>`;
}

function closeDiffModal() {
  document.getElementById('diffModal').classList.add('hidden');
  document.body.style.overflow = '';
  diffState.resultId = null;
  diffState.resultRow = null;
}

// ── File download ─────────────────────────────────────────────────────────────

async function downloadFile(fileId, filename, fmt) {
  try {
    const r = await fetch(`${API}/files/${fileId}/download`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.detail || 'İndirme verisi bulunamadı.'); return; }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename || `file_${fileId}.${fmt||'dwg'}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { alert('İndirme başarısız: ' + e.message); }
}
