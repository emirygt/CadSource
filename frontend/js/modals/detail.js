//  2.12 — DOSYA DETAY MODALI
// ══════════════════════════════════════════════════════════════════════════════

function fmtNum(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
function fmtPct(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}
function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = n / 1024;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return `${val.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${units[idx]}`;
}
function escHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const dataKeyLabels = {
  parser_used: 'Parser',
  primary_quality_score: 'Primary Kalite Skoru',
  recover_quality_score: 'Recover Kalite Skoru',
  primary_entity_count: 'Primary Entity Sayısı',
  recover_entity_count: 'Recover Entity Sayısı',
  insunits_code: 'INSUNITS Kodu',
  measurement_code: 'MEASUREMENT Kodu',
  insunits_label: 'Birim',
  dwg_version_code: 'DWG Versiyon Kodu',
  dwg_version_label: 'DWG Versiyonu',
  bbox_width: 'BBox Genişlik',
  bbox_height: 'BBox Yükseklik',
  bbox_area: 'BBox Alan',
  bbox_perimeter: 'BBox Çevre',
  aspect_ratio: 'En/Boy Oranı',
  diagonal_length: 'Diyagonal',
  entity_count: 'Entity Sayısı',
  layer_count: 'Katman Sayısı',
  entities_per_layer: 'Entity/Katman',
  entities_per_bbox_area: 'Entity/BBox Alan',
  dominant_entity_type: 'Baskın Entity Tipi',
  dominant_entity_ratio: 'Baskın Entity Oranı',
  line_total_length: 'Çizgi Toplam Uzunluk',
  arc_total_length: 'Yay Toplam Uzunluk',
  circle_total_length: 'Daire Çevre Toplam',
  polyline_total_length: 'Polyline Uzunluk',
  path_total_length: 'Toplam Yol Uzunluğu',
  unknown_arc_count: 'Bilinmeyen ARC',
  segment_count: 'Segment Sayısı',
  node_count: 'Düğüm Sayısı',
  odd_node_count: 'Tek Derece Düğüm',
  component_count: 'Bağlı Bileşen',
  cycle_rank_estimate: 'Döngü Tahmini',
  closed_graph_hint: 'Kapalı Grafik İpucu',
  closed_entity_hints: 'Kapalı Entity İpucu',
  preview_fill_ratio: 'Doluluk',
  estimated_profile_area: 'Tahmini Net Alan',
  estimated_void_area: 'Tahmini Boşluk Alanı',
  closed_contour_area_sum: 'Kapalı Kontur Alan Toplam',
  net_area_best_effort: 'Net Alan (Best-Effort)',
  file_size_bytes: 'Dosya Boyutu (Byte)',
  entities_included: 'Entity Dahil',
  bbox_min_x: 'BBox Min X',
  bbox_max_x: 'BBox Max X',
  bbox_min_y: 'BBox Min Y',
  bbox_max_y: 'BBox Max Y',
};

function keyToLabel(key) {
  if (dataKeyLabels[key]) return dataKeyLabels[key];
  return key
    .replaceAll('__', '_')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace('Bbox', 'BBox');
}

function isPrimitive(v) {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
}

function flattenObjectEntries(obj, prefix = '', depth = 0, maxDepth = 2) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}_${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < maxDepth) {
      out.push(...flattenObjectEntries(v, full, depth + 1, maxDepth));
    } else {
      out.push([full, v]);
    }
  }
  return out;
}

function renderDataValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    if (Number.isInteger(v)) return v.toLocaleString('tr-TR');
    return v.toLocaleString('tr-TR', { maximumFractionDigits: 6 });
  }
  if (typeof v === 'string') return escHtml(v);
  if (Array.isArray(v)) {
    if (!v.length) return '—';
    if (v.every(isPrimitive) && v.length <= 20) {
      return v.map(x => escHtml(x)).join(', ');
    }
    return `${v.length.toLocaleString('tr-TR')} kayıt`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length ? `${keys.length.toLocaleString('tr-TR')} alan` : '—';
  }
  return escHtml(String(v));
}

function renderDataCardsFromEntries(entries) {
  if (!entries.length) return '<div class="detail-note">Gösterilecek veri yok.</div>';
  return `<div class="detail-grid detail-fold-grid">` + entries.map(([k, v]) => `
    <div class="detail-stat">
      <div class="detail-stat-label">${escHtml(keyToLabel(k))}</div>
      <div class="detail-stat-val" style="font-size:12px">${renderDataValue(v)}</div>
    </div>
  `).join('') + `</div>`;
}

function renderDataCards(obj, options = {}) {
  const { excludeKeys = [] } = options;
  const rows = flattenObjectEntries(obj).filter(([k]) => !excludeKeys.includes(k));
  return renderDataCardsFromEntries(rows);
}

function buildRawSummary(raw) {
  const bbox = raw?.bbox || {};
  return {
    entity_count: raw?.entity_count,
    layer_count: raw?.layer_count,
    entities_included: raw?.entities_included,
    bbox_min_x: bbox.min_x,
    bbox_max_x: bbox.max_x,
    bbox_min_y: bbox.min_y,
    bbox_max_y: bbox.max_y,
    layers: raw?.layers || [],
    entity_types: raw?.entity_types || {},
  };
}

function renderEntityCards(entities) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return '<div class="detail-note">Entity verisi yok.</div>';
  }
  return `<div class="entity-grid">` + entities.map((ent, idx) => {
    const entries = Object.entries(ent || {}).filter(([k]) => k !== 'type').slice(0, 30);
    const rows = entries.map(([k, v]) => `<div class="entity-row"><span>${escHtml(keyToLabel(k))}</span><span>${renderDataValue(v)}</span></div>`).join('');
    return `
      <div class="entity-card">
        <div class="entity-card-title">#${(idx + 1).toLocaleString('tr-TR')} · ${escHtml(ent?.type || 'ENTITY')}</div>
        ${rows || '<div class="entity-row"><span>Detay</span><span>—</span></div>'}
      </div>
    `;
  }).join('') + `</div>`;
}

function duplicateStatusLabel(status) {
  const labels = {
    exact_duplicate: 'Exact duplicate',
    revision_candidate: 'Revizyon adayi',
    unique: 'Unique',
  };
  return labels[status] || status || 'Unique';
}

function renderDuplicateSection(f) {
  const group = Array.isArray(f.duplicate_group) ? f.duplicate_group : [];
  const jobs = Array.isArray(f.related_jobs) ? f.related_jobs : [];
  const status = duplicateStatusLabel(f.duplicate_status);
  const hashShort = f.content_hash ? `${String(f.content_hash).slice(0, 12)}...` : 'Yok';
  const geomShort = f.geometry_hash ? `${String(f.geometry_hash).slice(0, 12)}...` : 'Yok';
  const groupRows = group.length
    ? group.map(m => `
        <div class="entity-row">
          <span>${escHtml(m.role || 'member')} · #${m.file_id}</span>
          <span>${escHtml(m.filename || '')} ${m.score ? `(${Number(m.score).toFixed(3)})` : ''}</span>
        </div>
      `).join('')
    : '<div class="detail-note">Bu dosya icin duplicate/revizyon grubu yok.</div>';
  const jobRows = jobs.length
    ? jobs.map(j => {
        const when = j.finished_at || j.started_at || j.created_at;
        const date = when ? new Date(when).toLocaleString('tr-TR') : '-';
        return `
          <div class="entity-row">
            <span>#${j.id} · ${escHtml(j.type || j.action || 'job')}</span>
            <span>${escHtml(j.item_status || j.status || '')} · ${escHtml(date)}</span>
          </div>
        `;
      }).join('')
    : '<div class="detail-note">Bu dosyayla iliskili job kaydi yok.</div>';

  return `
    <div>
      <div class="detail-section-title">Duplicate / Revizyon</div>
      <div class="detail-grid">
        <div class="detail-stat"><div class="detail-stat-label">Durum</div><div class="detail-stat-val" style="font-size:12px">${escHtml(status)}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Grup</div><div class="detail-stat-val" style="font-size:12px">${f.duplicate_group_id || '-'}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Content Hash</div><div class="detail-stat-val" style="font-size:12px">${escHtml(hashShort)}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Geometry Hash</div><div class="detail-stat-val" style="font-size:12px">${escHtml(geomShort)}</div></div>
      </div>
      <details style="margin-top:8px">
        <summary>Ayni hash / revizyon adaylari (${group.length})</summary>
        <div class="detail-json-wrap" style="margin-top:8px">${groupRows}</div>
      </details>
      <details style="margin-top:8px">
        <summary>Bu dosyayla iliskili isler (${jobs.length})</summary>
        <div class="detail-json-wrap" style="margin-top:8px">${jobRows}</div>
      </details>
    </div>
  `;
}

async function showDetailModal(fileId, tab) {
  const modal = document.getElementById('detailModal');
  const body = document.getElementById('detailModalBody');
  const title = document.getElementById('detailModalTitle');

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  body.innerHTML = '<div class="loading"><div class="spinner"></div><div>Yükleniyor...</div></div>';
  if (tab) showDetailModal._pendingTab = { tab, fileId };

  try {
    const r = await fetch(`${API}/files/${fileId}?include_analysis=1&include_entities=1`, { headers: authH() });
    if (!r.ok) throw new Error('Dosya bulunamadı');
    const f = await r.json();

    title.textContent = f.filename;

    const size = (f.bbox_width && f.bbox_height)
      ? `${f.bbox_width.toFixed(0)} × ${f.bbox_height.toFixed(0)}`
      : '—';
    const area = f.bbox_area ? f.bbox_area.toFixed(0) : '—';
    const date = f.indexed_at ? new Date(f.indexed_at).toLocaleString('tr-TR') : '—';
    const categoryName = f.category_name || '—';
    const fileSize = fmtBytes(f.file_size_bytes);
    const fmt = (f.file_format || '').toUpperCase();
    const fmtColors = { DWG: '#60a5fa', DXF: '#4ade80', PDF: '#fbbf24' };
    const fmtColor = fmtColors[fmt] || '#8b93a8';

    // Entity tipleri
    const etypes = f.entity_types || {};
    const etypeChips = Object.entries(etypes)
      .sort((a,b) => b[1]-a[1])
      .map(([k,v]) => `<span class="detail-chip">${k}<span class="detail-chip-count">${v}</span></span>`)
      .join('');

    // Katmanlar
    const layers = f.layers || [];
    const layerChips = layers.map(l => `<span class="detail-chip">${l}</span>`).join('');

    // Önizleme — JPG önce, yoksa SVG
    const previewSection = f.jpg_preview
      ? `<div>
          <div class="detail-section-title">Önizleme</div>
          <div style="background:#f1f5f9;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);text-align:center;padding:8px">
            <img src="${f.jpg_preview}" style="max-width:100%;max-height:320px;object-fit:contain;border-radius:4px">
          </div>
         </div>`
      : f.svg_preview
        ? `<div>
            <div class="detail-section-title">Önizleme</div>
            <div style="background:#f1f5f9;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border)">${f.svg_preview}</div>
           </div>`
        : '';
    const duplicateSection = renderDuplicateSection(f);

    // Job history tab için ayrı fetch
    let jobHistoryHtml = '<div style="text-align:center;padding:20px;color:#94a3b8">Yükleniyor...</div>';
    fetch(`${API}/jobs?file_id=${fileId}&per_page=20`, { headers: authH() })
      .then(r => r.json())
      .then(d => {
        const jobs = d.jobs || [];
        const ST = { succeeded:'background:#dcfce7;color:#16a34a', running:'background:#e0f2fe;color:#0284c7', queued:'background:#fef9c3;color:#a16207', failed:'background:#fee2e2;color:#dc2626', cancelled:'background:#f1f5f9;color:#64748b' };
        const JT = { upload:'Upload', clip_backfill:'CLIP Backfill', reindex:'Re-index', gen_preview:'Preview', duplicate_rescan:'Dup Tarama' };
        const jPanel = document.getElementById('dtJobs');
        if (!jPanel) return;
        if (!jobs.length) { jPanel.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8">Bu dosyayla ilgili job yok</div>'; return; }
        jPanel.innerHTML = jobs.map(j => `<div class="job-item-row" style="cursor:pointer" onclick="showJobDetail(${j.id})">
          <span class="job-status-badge" style="${ST[j.status]||ST.queued}">${(j.status||'').toUpperCase()}</span>
          <span class="job-item-name">#${j.id} · ${JT[j.type]||j.type}</span>
          <span class="job-item-msg">${j.processed_items||0}/${j.total_items||0} · ${j.created_at ? new Date(j.created_at).toLocaleDateString('tr-TR') : ''}</span>
        </div>`).join('');
      }).catch(() => {});

    const previewContent = f.jpg_preview
      ? `<img src="${f.jpg_preview}" alt="${escHtml(f.filename)}">`
      : f.svg_preview
        ? f.svg_preview
        : '<div style="padding:40px;text-align:center;color:#94a3b8">Önizleme yok</div>';

    body.innerHTML = `
      <div class="detail-tab-bar">
        <button class="detail-tab-btn active" onclick="switchDetailTab('preview',this)">Önizleme</button>
        <button class="detail-tab-btn" onclick="switchDetailTab('analysis',this)">Analiz</button>
        <button class="detail-tab-btn" onclick="switchDetailTab('attributes',this);loadFileAttributesTab(${f.id})">Attributeler</button>
        <button class="detail-tab-btn" onclick="switchDetailTab('duplicate',this)">Duplicate</button>
        <button class="detail-tab-btn" onclick="switchDetailTab('jobs',this)">Job Geçmişi</button>
        <button class="detail-tab-btn" onclick="switchDetailTab('model3d',this);ensure3DViewer(${f.id})">3D Görünüm</button>
      </div>
      <div class="detail-sections" style="padding:0">
      <!-- ÖNIZLEME TAB -->
      <div id="dtPreview" class="detail-tab-panel active">
        <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px">
          <button onclick="zoomDetail(0.3)" style="padding:4px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;cursor:pointer;background:#fff">+</button>
          <button onclick="zoomDetail(-0.3)" style="padding:4px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;cursor:pointer;background:#fff">−</button>
          <button onclick="resetDetailZoom()" style="padding:4px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;cursor:pointer;background:#fff">Sıfırla</button>
        </div>
        <div class="preview-zoom-wrap" id="previewZoomWrap">
          <div class="preview-zoom-inner" id="previewZoomInner">${previewContent}</div>
        </div>
        <div style="margin-top:12px">
          <div class="detail-section-title">Genel Bilgi</div>
          <div class="detail-grid">
            <div class="detail-stat">
              <div class="detail-stat-label">Format</div>
              <div class="detail-stat-val" style="color:${fmtColor}">${fmt}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Entity Sayısı</div>
              <div class="detail-stat-val">${(f.entity_count||0).toLocaleString('tr')}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Katman Sayısı</div>
              <div class="detail-stat-val">${f.layer_count||0}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Boyutlar</div>
              <div class="detail-stat-val" style="font-size:13px">${size}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Kapsayan Alan (BBox)</div>
              <div class="detail-stat-val" style="font-size:13px">${area}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Kategori</div>
              <div class="detail-stat-val" style="font-size:12px">${categoryName}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Dosya Boyutu</div>
              <div class="detail-stat-val" style="font-size:12px">${fileSize}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Eklenme</div>
              <div class="detail-stat-val" style="font-size:11px;font-weight:400;color:var(--text2)">${date}</div>
            </div>
          </div>
        </div>
        </div>
      </div>
      <!-- ANALİZ TAB -->
      <div id="dtAnalysis" class="detail-tab-panel">
        ${etypeChips ? `<div>
          <div class="detail-section-title">Entity Tipleri</div>
          <div class="detail-chips">${etypeChips}</div>
        </div>` : ''}
        ${layerChips ? `<div>
          <div class="detail-section-title">Katmanlar (${layers.length})</div>
          <div class="detail-chips">${layerChips}</div>
        </div>` : ''}
        <div>
          <div class="detail-section-title">Dosya Yolu</div>
          <div style="font-size:12px;color:var(--text3);word-break:break-all;background:var(--bg3);padding:8px 12px;border-radius:6px;border:1px solid var(--border)">${f.filepath}</div>
        </div>
        ${(() => {
          const analysis = f.analysis;
          if (!analysis) return '';
          if (!analysis.available) {
            return `<div class="detail-note">Analiz üretilemedi: ${escHtml(analysis.reason || 'Bilinmeyen neden')}</div>`;
          }
          const p = analysis.parser || {};
          const c = analysis.calculated || {};
          const raw = analysis.raw || {};
          const parserUsed = p.parser_used || '—';
          const dwgVersion = p.dwg_version_label
            ? `${p.dwg_version_label} (${p.dwg_version_code || ''})`
            : (p.dwg_version_code || '—');
          const units = p.insunits_label || 'Bilinmiyor';
          const netArea = fmtNum(c.net_area_best_effort, 3);
          const fill = fmtPct(c.preview_fill_ratio, 2);
          const closedHint = c.closed_graph_hint ? 'Evet' : 'Hayır';
          const rawSummary = buildRawSummary(raw);
          const rawEntities = Array.isArray(raw.entities) ? raw.entities : [];

          const parserCards = renderDataCards(p);
          const calcCards = renderDataCards(c);
          const rawSummaryCards = renderDataCards(rawSummary);
          const entityCards = renderEntityCards(rawEntities);

          return `
          <div>
            <div class="detail-section-title">Dosya Analizi (Ham + Hesaplama)</div>
            <div class="detail-grid">
              <div class="detail-stat"><div class="detail-stat-label">Parser</div><div class="detail-stat-val" style="font-size:12px">${parserUsed}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">DWG Versiyonu</div><div class="detail-stat-val" style="font-size:12px">${dwgVersion}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Birim (INSUNITS)</div><div class="detail-stat-val" style="font-size:12px">${units}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Net Alan (Best-Effort)</div><div class="detail-stat-val" style="font-size:12px">${netArea}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Doluluk (Preview)</div><div class="detail-stat-val" style="font-size:12px">${fill}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Kapalı Grafik İpucu</div><div class="detail-stat-val" style="font-size:12px">${closedHint}</div></div>
            </div>
          </div>
          <div>
            <div class="detail-section-title">Hesaplanan Metrikler</div>
            <div class="detail-grid">
              <div class="detail-stat"><div class="detail-stat-label">En/Boy Oranı</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.aspect_ratio, 4)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Diyagonal</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.diagonal_length, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">BBox Çevre</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.bbox_perimeter, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Entity/Katman</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.entities_per_layer, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Entity/BBox Alan</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.entities_per_bbox_area, 6)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Baskın Entity</div><div class="detail-stat-val" style="font-size:12px">${escHtml(c.dominant_entity_type || '—')} (${fmtPct(c.dominant_entity_ratio, 1)})</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Çizgi Toplam Uzunluk</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.line_total_length, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Yay Toplam Uzunluk</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.arc_total_length, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Daire Çevre Toplam</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.circle_total_length, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Polyline Uzunluk</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.polyline_total_length, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Toplam Yol Uzunluğu</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.path_total_length, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Bilinmeyen ARC</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.unknown_arc_count, 0)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Segment</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.segment_count, 0)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Düğüm</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.node_count, 0)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Tek Derece Düğüm</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.odd_node_count, 0)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Bağlı Bileşen</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.component_count, 0)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Döngü Tahmini</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.cycle_rank_estimate, 0)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Kapalı Kontur Alan Toplam</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.closed_contour_area_sum, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Tahmini Net Kesit Alanı</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.estimated_profile_area, 3)}</div></div>
              <div class="detail-stat"><div class="detail-stat-label">Tahmini Boşluk Alanı</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.estimated_void_area, 3)}</div></div>
            </div>
          </div>
          <div class="detail-json-wrap" style="display:flex;flex-direction:column;gap:8px">
            <div class="detail-section-title">Ham Veri Blokları</div>
            <details>
              <summary>Parser Bilgisi (${Object.keys(p || {}).length} alan)</summary>
              ${parserCards}
            </details>
            <details>
              <summary>Hesaplamalar (${Object.keys(c || {}).length} alan)</summary>
              ${calcCards}
            </details>
            <details>
              <summary>Ham Geometri Özeti (${fmtNum(raw.entity_count, 0)} entity)</summary>
              ${rawSummaryCards}
            </details>
            <details>
              <summary>Entity Listesi (${rawEntities.length.toLocaleString('tr-TR')} kayıt)</summary>
              ${entityCards}
            </details>
          </div>`;
        })()}
        ${f.file_data !== null && f.file_data !== undefined ? `
        <div style="margin-top:8px">
          <button onclick="downloadFile(${f.id},'${(f.filename||'').replace(/'/g,"\\'")}','${f.file_format||'dwg'}')" style="background:rgba(59,130,246,0.12);color:var(--blue);border:1px solid rgba(59,130,246,0.3);border-radius:6px;padding:8px 20px;font-size:13px;font-weight:500;cursor:pointer;width:100%">
            ↓ ${f.filename} İndir
          </button>
        </div>` : ''}
      </div>
      <!-- DUPLICATE TAB -->
      <div id="dtDuplicate" class="detail-tab-panel">
        ${duplicateSection}
        ${f.duplicate_group && f.duplicate_group.length >= 2 ? `
        <div style="margin-top:10px">
          <button onclick="openCompareFromDetail(${f.id}, ${f.duplicate_group[0]?.file_id || 0})" style="padding:7px 16px;background:#dbeafe;color:#1d4ed8;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Orijinalle Karşılaştır</button>
        </div>` : ''}
      </div>
      <!-- ATTRİBUTE TAB -->
      <div id="dtAttributes" class="detail-tab-panel">
        <div style="padding:8px 0;color:#94a3b8;font-size:13px">Yükleniyor...</div>
      </div>
      <!-- JOB GEÇMİŞİ TAB -->
      <div id="dtJobs" class="detail-tab-panel">
        <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px">Bu dosyayla ilgili işlemler</div>
        <div class="job-items-list" id="dtJobsList" style="max-height:none"><div style="padding:20px;text-align:center;color:#94a3b8">Yükleniyor...</div></div>
      </div>
      <!-- 3D GÖRÜNÜM TAB -->
      <div id="dtModel3d" class="detail-tab-panel">
        <div id="viewer3dContainer" style="width:100%;height:440px;background:#f1f5f9;border-radius:10px;overflow:hidden;position:relative;border:1px solid var(--border)">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px">3D Görünüm sekmesine tıklayın</div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#94a3b8;text-align:center">Sol tık: döndür · Sağ tık / 2 parmak: kaydır · Tekerlek: zoom</div>
      </div>
      </div>`;
    _initDetailZoomPan();
    const pending = showDetailModal._pendingTab;
    if (pending && pending.fileId === fileId) {
      showDetailModal._pendingTab = null;
      const tabBtn = [...document.querySelectorAll('.detail-tab-btn')].find(b => b.textContent.includes('3D'));
      if (tabBtn) { switchDetailTab('model3d', tabBtn); ensure3DViewer(fileId); }
    }
  } catch (err) {
    body.innerHTML = `<div style="color:var(--red);padding:20px">${err.message}</div>`;
  }
}

function switchDetailTab(name, btn) {
  document.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.detail-tab-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('dt' + name.charAt(0).toUpperCase() + name.slice(1));
  if (panel) panel.classList.add('active');
}

const _detailZoom = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };

function _initDetailZoomPan() {
  const wrap = document.getElementById('previewZoomWrap');
  const inner = document.getElementById('previewZoomInner');
  if (!wrap || !inner) return;
  _detailZoom.scale = 1; _detailZoom.tx = 0; _detailZoom.ty = 0;
  const apply = () => { inner.style.transform = `translate(${_detailZoom.tx}px, ${_detailZoom.ty}px) scale(${_detailZoom.scale})`; };
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    _detailZoom.scale = Math.min(8, Math.max(0.5, _detailZoom.scale + (e.deltaY < 0 ? 0.15 : -0.15)));
    apply();
  }, { passive: false });
  wrap.addEventListener('mousedown', e => {
    _detailZoom.dragging = true; _detailZoom.startX = e.clientX; _detailZoom.startY = e.clientY;
    _detailZoom.startTx = _detailZoom.tx; _detailZoom.startTy = _detailZoom.ty;
  });
  document.addEventListener('mousemove', e => {
    if (!_detailZoom.dragging) return;
    _detailZoom.tx = _detailZoom.startTx + (e.clientX - _detailZoom.startX);
    _detailZoom.ty = _detailZoom.startTy + (e.clientY - _detailZoom.startY);
    apply();
  });
  document.addEventListener('mouseup', () => { _detailZoom.dragging = false; });
}

function zoomDetail(delta) {
  _detailZoom.scale = Math.min(8, Math.max(0.5, _detailZoom.scale + delta));
  const inner = document.getElementById('previewZoomInner');
  if (inner) inner.style.transform = `translate(${_detailZoom.tx}px, ${_detailZoom.ty}px) scale(${_detailZoom.scale})`;
}

function resetDetailZoom() {
  _detailZoom.scale = 1; _detailZoom.tx = 0; _detailZoom.ty = 0;
  const inner = document.getElementById('previewZoomInner');
  if (inner) inner.style.transform = 'translate(0,0) scale(1)';
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.add('hidden');
  document.body.style.overflow = '';
  dispose3D();
  _fileAttrLoaded = null;
}

// ── 3D Viewer ────────────────────────────────────────────────────────────────
let _viewer3d = null;

async function ensure3DViewer(fileId) {
  const container = document.getElementById('viewer3dContainer');
  if (!container) return;
  if (_viewer3d && _viewer3d.fileId === fileId) return;
  dispose3D();

  container.innerHTML = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#94a3b8">
      <div class="spinner"></div>
      <div style="font-size:12px">3D model hazırlanıyor…</div>
    </div>`;

  try {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

    const resp = await fetch(`${API}/files/${fileId}/model3d`, { headers: authH() });
    if (!resp.ok) throw new Error('3D model oluşturulamadı (' + resp.status + ')');
    const glbBuffer = await resp.arrayBuffer();

    container.innerHTML = '';

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0xf1f5f9);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.2);
    d1.position.set(5, 10, 8);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0x6699ff, 0.35);
    d2.position.set(-4, -2, -6);
    scene.add(d2);

    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.01, 50000);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.8;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    await new Promise((resolve, reject) => {
      new GLTFLoader().parse(glbBuffer, '', (gltf) => {
        const model = gltf.scene;
        scene.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = (maxDim / 2) / Math.tan((camera.fov * Math.PI / 180) / 2) * 2.4;
        camera.position.set(dist * 0.6, dist * 0.45, dist * 0.9);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
        resolve();
      }, reject);
    });

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    let animId;
    (function animate() {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();

    _viewer3d = { fileId, renderer, controls, animId, ro };

  } catch (err) {
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">
        <div style="color:#ef4444;font-size:13px">3D model yüklenemedi</div>
        <div style="color:#94a3b8;font-size:11px">${err.message || ''}</div>
      </div>`;
  }
}

function dispose3D() {
  if (!_viewer3d) return;
  cancelAnimationFrame(_viewer3d.animId);
  _viewer3d.controls.dispose();
  _viewer3d.renderer.dispose();
  _viewer3d.ro.disconnect();
  const c = _viewer3d.renderer.domElement;
  if (c.parentNode) c.parentNode.removeChild(c);
  _viewer3d = null;
}

