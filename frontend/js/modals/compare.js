//  2.11 — KARŞILAŞTIRMA MODALI
// ══════════════════════════════════════════════════════════════════════════════


function toggleCompare(id) {
  const results = searchState.results?.results || [];
  const item = results.find(r => r.id === id);
  if (!item) return;

  const idx = compareState.items.findIndex(c => c.id === id);
  if (idx >= 0) {
    compareState.items.splice(idx, 1);
  } else {
    if (compareState.items.length >= 2) {
      compareState.items.shift();  // en eskiyi çıkar
    }
    compareState.items.push(item);
  }

  // Kartları yeniden render et
  if (searchState.results) renderResults(searchState.results);

  // 2 seçili ise bildirim göster
  if (compareState.items.length === 2) {
    showCompareToast();
  }
}

function showCompareToast() {
  let toast = document.getElementById('compareToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'compareToast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg2);border:1px solid var(--amber);border-radius:10px;padding:10px 20px;display:flex;align-items:center;gap:12px;z-index:200;font-size:13px;box-shadow:0 4px 24px rgba(0,0,0,0.4)';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `
    <span style="color:var(--amber)">2 dosya seçildi</span>
    <button onclick="openCompareModal()" style="background:var(--amber);color:#000;border:none;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer">Karşılaştır →</button>
    <button onclick="clearCompare()" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:16px;line-height:1">×</button>`;
  toast.style.display = 'flex';
}

function clearCompare() {
  compareState.items = [];
  const toast = document.getElementById('compareToast');
  if (toast) toast.style.display = 'none';
  if (searchState.results) renderResults(searchState.results);
}

function openCompareModal() {
  if (compareState.items.length < 2) return;
  const [a, b] = compareState.items;
  const queryData = searchState.results || {};
  const queryStats = queryData.query_stats || {};
  const queryFile = queryData.query_file || 'Aranan Dosya';
  const queryPreview = queryData.query_preview || null;
  const qW = Number(queryStats.bbox_width || 0);
  const qH = Number(queryStats.bbox_height || 0);
  const qArea = Number(queryStats.bbox_area || (qW * qH) || 0);
  const qExt = queryFile.includes('.') ? queryFile.split('.').pop() : '';
  const qFmt = (qExt || 'dosya').toUpperCase();

  document.getElementById('compareModalTitle').textContent = 'Karşılaştırma';
  const body = document.getElementById('compareModalBody');

  function queryColHtml() {
    return `
      <div class="compare-col compare-query-col">
        <div class="compare-col-header" style="background:rgba(59,130,246,0.2);color:#0ea5e9;border:1px solid rgba(59,130,246,0.7)">ARANAN DOSYA: ${queryFile}</div>
        <div class="compare-preview-box" id="cmp_preview_query">
          ${queryPreview
            ? `<img src="${queryPreview}" alt="Aranan dosya önizleme">`
            : `<span style="font-size:11px;color:var(--text3)">Önizleme yok</span>`
          }
        </div>
        <div class="compare-stats" id="cmp_stats_query">
          <div class="compare-stat-row">
            <span class="compare-stat-label">Benzerlik</span>
            <span class="compare-stat-val" style="color:#0ea5e9">Referans</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Entity</span>
            <span class="compare-stat-val">${Number(queryStats.entity_count || 0).toLocaleString('tr')}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Katman</span>
            <span class="compare-stat-val">${Number(queryStats.layer_count || 0)}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Boyut</span>
            <span class="compare-stat-val" style="font-size:11px">${qW > 0 && qH > 0 ? `${qW.toFixed(0)} × ${qH.toFixed(0)}` : '—'}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Kapsayan Alan (BBox)</span>
            <span class="compare-stat-val">${qArea > 0 ? qArea.toFixed(0) : '—'}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Format</span>
            <span class="compare-stat-val">${qFmt}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Net Alan (Best-Effort)</span>
            <span class="compare-stat-val">—</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Doluluk</span>
            <span class="compare-stat-val">—</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Toplam Yol Uzunluğu</span>
            <span class="compare-stat-val">—</span>
          </div>
        </div>
        <div class="compare-empty-note">Bu kart arama referansıdır. A ve B sonuçları buna göre yorumlanır.</div>
      </div>`;
  }

  function colHtml(item, label, color) {
    const etypes = item.entity_types || {};
    const topTypes = Object.entries(etypes).sort((x,y)=>y[1]-x[1]).slice(0,5)
      .map(([k,v]) => `<span class="detail-chip">${k}<span class="detail-chip-count">${v}</span></span>`).join('');
    const layers = (item.layers||[]).slice(0,8).map(l=>`<span class="detail-chip">${l}</span>`).join('');
    const reasons = buildMatchReasons(queryStats, item);
    const reasonBlock = reasons.length
      ? `<div><div class="detail-section-title" style="margin-top:4px">Neden benzer?</div>${reasonListHtml(reasons)}</div>`
      : `<div><div class="detail-section-title" style="margin-top:4px">Neden benzer?</div><div class="reason-empty">Ayrıntılı sebep üretilemedi.</div></div>`;
    return `
      <div class="compare-col">
        <div class="compare-col-header" style="background:${color}18;color:${color};border:1px solid ${color}44">
          ${label}: ${item.filename}
          <button class="cmp-btn" style="border-color:rgba(16,185,129,0.5);color:#10b981;font-size:10px;padding:2px 8px;margin-left:6px" onclick="closeCompareModal();openDiffModal(${item.id})" title="Aranan ile bu sonuç arasında fark haritası">◐ Fark</button>
        </div>
        <div class="compare-preview-box" id="cmp_preview_${item.id}">
          <span style="font-size:11px;color:var(--text3)">Yükleniyor...</span>
        </div>
        <div class="compare-stats" id="cmp_stats_${item.id}">
          <div class="compare-stat-row">
            <span class="compare-stat-label">Benzerlik</span>
            <span class="compare-stat-val" style="color:${simColor(item.similarity)}">${item.similarity}%</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Entity</span>
            <span class="compare-stat-val">${(item.entity_count||0).toLocaleString('tr')}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Katman</span>
            <span class="compare-stat-val">${item.layer_count||0}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Boyut</span>
            <span class="compare-stat-val" style="font-size:11px">${item.bbox_width?item.bbox_width.toFixed(0):'—'} × ${item.bbox_height?item.bbox_height.toFixed(0):'—'}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Kapsayan Alan (BBox)</span>
            <span class="compare-stat-val">${item.bbox_area?item.bbox_area.toFixed(0):'—'}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Format</span>
            <span class="compare-stat-val">${(item.file_format||'').toUpperCase()}</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Net Alan (Best-Effort)</span>
            <span class="compare-stat-val" id="cmp_net_${item.id}">—</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Doluluk</span>
            <span class="compare-stat-val" id="cmp_fill_${item.id}">—</span>
          </div>
          <div class="compare-stat-row">
            <span class="compare-stat-label">Toplam Yol Uzunluğu</span>
            <span class="compare-stat-val" id="cmp_path_${item.id}">—</span>
          </div>
        </div>
        <div class="compare-analysis-wrap" id="cmp_analysis_${item.id}">
          <div class="compare-empty-note">Analiz verisi yükleniyor...</div>
        </div>
        ${reasonBlock}
        ${topTypes ? `<div><div class="detail-section-title" style="margin-top:4px">Entity Tipleri</div><div class="detail-chips">${topTypes}</div></div>` : ''}
        ${layers ? `<div><div class="detail-section-title" style="margin-top:4px">Katmanlar</div><div class="detail-chips">${layers}</div></div>` : ''}
      </div>`;
  }

  body.innerHTML =
    queryColHtml() +
    '<div class="compare-divider"></div>' +
    colHtml(a, 'A', '#3b82f6') +
    '<div class="compare-divider"></div>' +
    colHtml(b, 'B', '#f59e0b');

  // Önizleme + analiz verilerini async yükle
  loadCompareDetailData(a.id);
  loadCompareDetailData(b.id);

  document.getElementById('compareModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderCompareAnalysis(fileId, fileData) {
  const analysisEl = document.getElementById(`cmp_analysis_${fileId}`);
  if (!analysisEl) return;
  const analysis = fileData?.analysis;
  if (!analysis || !analysis.available) {
    analysisEl.innerHTML = `<div class="compare-empty-note">Analiz yok: ${escHtml(analysis?.reason || 'Veri üretilemedi')}</div>`;
    return;
  }

  const p = analysis.parser || {};
  const c = analysis.calculated || {};
  const raw = analysis.raw || {};

  const parserUsed = p.parser_used || '—';
  const dwgVersion = p.dwg_version_label
    ? `${p.dwg_version_label} (${p.dwg_version_code || ''})`
    : (p.dwg_version_code || '—');
  const units = p.insunits_label || 'Bilinmiyor';
  const closedHint = c.closed_graph_hint ? 'Evet' : 'Hayır';
  const rawSummary = buildRawSummary(raw);
  const rawEntities = Array.isArray(raw.entities) ? raw.entities : [];
  const parserCards = renderDataCards(p);
  const calcCards = renderDataCards(c);
  const rawSummaryCards = renderDataCards(rawSummary);
  const entityCards = renderEntityCards(rawEntities);

  analysisEl.innerHTML = `
    <div>
      <div class="detail-section-title" style="margin-top:2px">Dosya Analizi</div>
      <div class="compare-analysis-grid">
        <div class="detail-stat"><div class="detail-stat-label">Parser</div><div class="detail-stat-val" style="font-size:12px">${parserUsed}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">DWG Versiyonu</div><div class="detail-stat-val" style="font-size:12px">${dwgVersion}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Birim</div><div class="detail-stat-val" style="font-size:12px">${units}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Kapalı Grafik</div><div class="detail-stat-val" style="font-size:12px">${closedHint}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Net Alan (Best-Effort)</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.net_area_best_effort, 3)}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Doluluk</div><div class="detail-stat-val" style="font-size:12px">${fmtPct(c.preview_fill_ratio, 2)}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Toplam Yol Uzunluğu</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.path_total_length, 3)}</div></div>
        <div class="detail-stat"><div class="detail-stat-label">Döngü Tahmini</div><div class="detail-stat-val" style="font-size:12px">${fmtNum(c.cycle_rank_estimate, 0)}</div></div>
      </div>
    </div>
    <div class="compare-json" style="display:flex;flex-direction:column;gap:8px">
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
    </div>
  `;
}

async function loadCompareDetailData(fileId) {
  try {
    const r = await fetch(`${API}/files/${fileId}?include_analysis=1&include_entities=1`, { headers: authH() });
    if (!r.ok) return;
    const f = await r.json();
    const previewEl = document.getElementById(`cmp_preview_${fileId}`);
    if (previewEl) {
      if (f.jpg_preview) {
        previewEl.innerHTML = `<img src="${f.jpg_preview}" alt="Karşılaştırma önizleme">`;
      } else if (f.svg_preview) {
        previewEl.innerHTML = `<div class="compare-svg-fit">${f.svg_preview}</div>`;
      } else {
        previewEl.innerHTML = `<span style="font-size:11px;color:var(--text3)">Önizleme yok</span>`;
      }
    }
    const c = f.analysis?.available ? (f.analysis.calculated || {}) : {};
    const netEl = document.getElementById(`cmp_net_${fileId}`);
    const fillEl = document.getElementById(`cmp_fill_${fileId}`);
    const pathEl = document.getElementById(`cmp_path_${fileId}`);
    if (netEl) netEl.textContent = fmtNum(c.net_area_best_effort, 3);
    if (fillEl) fillEl.textContent = fmtPct(c.preview_fill_ratio, 2);
    if (pathEl) pathEl.textContent = fmtNum(c.path_total_length, 3);
    renderCompareAnalysis(fileId, f);
  } catch {}
}

function closeCompareModal() {
  document.getElementById('compareModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════
// NEDEN BENZER? — Tek sonuç için tüm gerekçelerin popup listesi
// ═══════════════════════════════════════════════════════
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
      ${r.geometry_guard != null ? `<div style="padding:4px 10px;border-radius:6px;background:rgba(245,158,11,0.12);color:#b45309">Geometri: <b>%${r.geometry_guard}</b></div>` : ''}
    </div>`;
  const body = document.getElementById('reasonModalBody');
  body.innerHTML = scoreRow + reasonListHtml(reasons) +
    `<div style="margin-top:12px;font-size:10.5px;color:var(--text3);line-height:1.5">
       Yeşil = güçlü benzerlik · Sarı = kısmi benzerlik · Kırmızı = bu yönde zayıf uyum.
       Skorlar sorguyla karşılaştırmalı hesaplanır (CLIP=semantik görsel, siluet=dış hat, geometri=en/boy+entity oranı).
     </div>`;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeReasonModal() {
  const modal = document.getElementById('reasonModal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════
// DIFF OVERLAY — Aranan dosya ile sonuç arasında piksel-bazlı fark
// Yeşil = iki çizimde de olan kontur (eşleşme)
// Kırmızı = sadece aranan dosyada olan (yok olan detay)
// Mavi    = sadece bulunan sonuçta olan (ekstra detay)
// ═══════════════════════════════════════════════════════
const diffState = {
  mode: 'overlay',       // overlay | side | onlyA | onlyB
  resultId: null,
  resultRow: null,
  canvas: null,
  imgQ: null,
  imgR: null,
};

function openDiffModal(resultId) {
  const data = searchState.results;
  if (!data || !Array.isArray(data.results)) {
    alert('Önce bir arama yapmanız gerekiyor.');
    return;
  }
  const row = data.results.find(x => x.id === resultId);
  if (!row) return;
  const queryPreview = data.query_preview;
  if (!queryPreview) {
    alert('Aranan dosyanın önizlemesi bulunamadı — fark hesaplanamıyor.');
    return;
  }
  if (!row.jpg_preview) {
    alert('Bu sonucun JPEG önizlemesi yok — fark hesaplanamıyor.');
    return;
  }

  diffState.resultId = resultId;
  diffState.resultRow = row;
  diffState.mode = 'overlay';

  document.getElementById('diffModalTitle').textContent =
    `Fark Görünümü — ${data.query_file || 'Aranan'} ↔ ${row.filename}`;

  const body = document.getElementById('diffModalBody');
  body.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <div style="display:flex;gap:6px">
        <button class="cmp-btn diff-mode-btn active" data-mode="overlay" onclick="setDiffMode('overlay')">◐ Bindirme (Fark)</button>
        <button class="cmp-btn diff-mode-btn" data-mode="side" onclick="setDiffMode('side')">▦ Yan yana</button>
        <button class="cmp-btn diff-mode-btn" data-mode="onlyA" onclick="setDiffMode('onlyA')">Sadece Aranan</button>
        <button class="cmp-btn diff-mode-btn" data-mode="onlyB" onclick="setDiffMode('onlyB')">Sadece Sonuç</button>
      </div>
      <div style="flex:1"></div>
      <div style="display:flex;gap:12px;font-size:11px;color:#475569;align-items:center">
        <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px"></span>Eşleşen kontur</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px"></span>Sadece aranan</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:2px;margin-right:4px"></span>Sadece sonuç</span>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:space-around" id="diffCanvasRow">
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
    </div>
  `;

  document.getElementById('diffModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Resimleri yükle, sonra diff'i hesapla
  const imgA = document.getElementById('diffImgA');
  const imgB = document.getElementById('diffImgB');
  const canvas = document.getElementById('diffCanvas');
  diffState.canvas = canvas;

  let loadedA = false, loadedB = false;
  const tryRender = () => {
    if (loadedA && loadedB) {
      diffState.imgQ = imgA;
      diffState.imgR = imgB;
      renderDiffCanvas();
    }
  };
  if (imgA.complete && imgA.naturalWidth > 0) { loadedA = true; } else { imgA.onload = () => { loadedA = true; tryRender(); }; }
  if (imgB.complete && imgB.naturalWidth > 0) { loadedB = true; } else { imgB.onload = () => { loadedB = true; tryRender(); }; }
  tryRender();
}

function setDiffMode(mode) {
  diffState.mode = mode;
  document.querySelectorAll('.diff-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  renderDiffCanvas();
}

function renderDiffCanvas() {
  const canvas = diffState.canvas;
  const imgA = diffState.imgQ;
  const imgB = diffState.imgR;
  if (!canvas || !imgA || !imgB) return;

  // Ortak tuval boyutuna normalize et (en büyük boyut, oran korunarak)
  const TARGET_W = 640;
  const ratioA = imgA.naturalHeight / imgA.naturalWidth;
  const ratioB = imgB.naturalHeight / imgB.naturalWidth;
  const ratio = (ratioA + ratioB) / 2;
  const W = TARGET_W;
  const H = Math.round(W * ratio);
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Yan yana modu: iki resmi yan yana çiz
  if (diffState.mode === 'side') {
    const halfW = W / 2;
    ctx.drawImage(imgA, 0, 0, halfW, H);
    ctx.drawImage(imgB, halfW, 0, halfW, H);
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath(); ctx.moveTo(halfW, 0); ctx.lineTo(halfW, H); ctx.stroke();
    document.getElementById('diffStats').textContent = 'Yan yana karşılaştırma';
    return;
  }
  if (diffState.mode === 'onlyA') {
    ctx.drawImage(imgA, 0, 0, W, H);
    document.getElementById('diffStats').textContent = 'Sadece aranan dosya';
    return;
  }
  if (diffState.mode === 'onlyB') {
    ctx.drawImage(imgB, 0, 0, W, H);
    document.getElementById('diffStats').textContent = 'Sadece sonuç dosyası';
    return;
  }

  // overlay modu: iki görüntüyü aynı tuvale bas, piksel bazlı fark hesapla
  // Önce iki off-screen canvas'a normalize et
  const offA = document.createElement('canvas'); offA.width = W; offA.height = H;
  const offB = document.createElement('canvas'); offB.width = W; offB.height = H;
  const cxA = offA.getContext('2d', { willReadFrequently: true });
  const cxB = offB.getContext('2d', { willReadFrequently: true });
  cxA.fillStyle = '#ffffff'; cxA.fillRect(0, 0, W, H);
  cxB.fillStyle = '#ffffff'; cxB.fillRect(0, 0, W, H);
  cxA.drawImage(imgA, 0, 0, W, H);
  cxB.drawImage(imgB, 0, 0, W, H);

  let dataA, dataB;
  try {
    dataA = cxA.getImageData(0, 0, W, H);
    dataB = cxB.getImageData(0, 0, W, H);
  } catch (e) {
    // base64 data URI'lar aynı origin'den sayılır ama yine de emniyetli ol
    document.getElementById('diffStats').textContent = 'Fark hesaplanamadı: ' + e.message;
    return;
  }

  const out = ctx.createImageData(W, H);
  const pa = dataA.data, pb = dataB.data, po = out.data;
  const TH = 180;  // gri eşik — bu değerin altı "çizgi piksel" sayılır
  let matchCount = 0, onlyACount = 0, onlyBCount = 0, totalInk = 0;

  for (let i = 0; i < pa.length; i += 4) {
    const lumA = 0.299 * pa[i] + 0.587 * pa[i+1] + 0.114 * pa[i+2];
    const lumB = 0.299 * pb[i] + 0.587 * pb[i+1] + 0.114 * pb[i+2];
    const inkA = lumA < TH;
    const inkB = lumB < TH;

    if (inkA && inkB) {
      // eşleşen — yeşil
      po[i] = 34; po[i+1] = 197; po[i+2] = 94; po[i+3] = 255;
      matchCount++; totalInk += 2;
    } else if (inkA) {
      // sadece aranan — kırmızı
      po[i] = 239; po[i+1] = 68; po[i+2] = 68; po[i+3] = 255;
      onlyACount++; totalInk++;
    } else if (inkB) {
      // sadece sonuç — mavi
      po[i] = 59; po[i+1] = 130; po[i+2] = 246; po[i+3] = 255;
      onlyBCount++; totalInk++;
    } else {
      // ikisi de boş — beyaz
      po[i] = 255; po[i+1] = 255; po[i+2] = 255; po[i+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const totalPaint = matchCount + onlyACount + onlyBCount;
  const matchPct = totalPaint > 0 ? ((matchCount / totalPaint) * 100).toFixed(1) : '0';
  const onlyAPct = totalPaint > 0 ? ((onlyACount / totalPaint) * 100).toFixed(1) : '0';
  const onlyBPct = totalPaint > 0 ? ((onlyBCount / totalPaint) * 100).toFixed(1) : '0';
  document.getElementById('diffStats').innerHTML =
    `Eşleşen piksel: <b style="color:#22c55e">%${matchPct}</b> · ` +
    `Sadece aranan: <b style="color:#ef4444">%${onlyAPct}</b> · ` +
    `Sadece sonuç: <b style="color:#3b82f6">%${onlyBPct}</b> · ` +
    `Eşik: ${TH}/255`;
}

function closeDiffModal() {
  document.getElementById('diffModal').classList.add('hidden');
  document.body.style.overflow = '';
  diffState.resultId = null;
  diffState.resultRow = null;
}


async function downloadFile(fileId, filename, fmt) {
  try {
    const r = await fetch(`${API}/files/${fileId}/download`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.detail || 'İndirme verisi bulunamadı. Dosya yeniden yüklenmesi gerekebilir.');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `file_${fileId}.${fmt||'dwg'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('İndirme başarısız: ' + e.message);
  }
}
