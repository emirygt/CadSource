// ═══════════════════════════════════════════════════════
// SCAN → CAD
// ═══════════════════════════════════════════════════════
const scanState = {
  file: null,
  entities: null,       // {lines, circles, arcs, texts, width, height}
  history: [],          // undo stack
  selectedIdx: null,    // {type, index}
  tool: 'select',       // 'select' | 'line' | 'circle' | 'arc' | 'move'
  zoom: 1,
  pan: { x: 0, y: 0 },
  drawing: false,
  drawStart: null,
  dragging: false,
  dragStart: null,
  arcPoints: [],        // Yay çizimi için 3-nokta biriktirme
  svgMode: false,       // false = Canvas, true = SVG teknik görünüm
  canvas: null,
  ctx: null,
};

const CAD_ENTITY_KEYS = [
  'lines','circles','arcs','texts','polylines','rectangles','polygons',
  'dimensions','splines','ellipses','points','xlines','rays','leaders',
];

function scanEnsureCadEntityCollections(entities) {
  const e = entities || {};
  CAD_ENTITY_KEYS.forEach(k => { if (!Array.isArray(e[k])) e[k] = []; });
  if (typeof e.width !== 'number') e.width = 500;
  if (typeof e.height !== 'number') e.height = 500;
  return e;
}

function scanEntityCounts(entities = scanState.entities) {
  const e = entities || {};
  const counts = {
    lines: (e.lines || []).length,
    circles: (e.circles || []).length,
    arcs: (e.arcs || []).length,
  };
  counts.total = CAD_ENTITY_KEYS.reduce((sum, key) => sum + ((e[key] || []).length), 0);
  return counts;
}

function scanUpdateCadEditorPanel() {
  const btn = document.getElementById('scanCadEditorBtn');
  const status = document.getElementById('scanCadEditorStatus');
  const meta = document.getElementById('scanCadEditorMeta');
  if (!btn || !status || !meta) return;
  const counts = scanEntityCounts();
  const ready = counts.total > 0;
  btn.disabled = !ready;
  status.textContent = ready ? `${t('scan.cad_editor_ready')} · ${counts.total} entity` : t('scan.cad_editor_waiting');
  meta.innerHTML = `
    <span><b>${counts.lines}</b>${t('scan.stat_lines')}</span>
    <span><b>${counts.circles}</b>${t('scan.stat_circles')}</span>
    <span><b>${counts.arcs}</b>${t('scan.stat_arcs')}</span>
  `;
}

function scanInit() {
  if (scanState.canvas) { scanUpdateCadEditorPanel(); return; }
  const c = document.getElementById('scanCanvas');
  const wrap = document.getElementById('scanCanvasWrap');
  c.width = wrap.clientWidth || 800;
  c.height = 500;
  scanState.canvas = c;
  scanState.ctx = c.getContext('2d');

  c.addEventListener('mousemove', scanOnMouseMove);
  c.addEventListener('mousedown', scanOnMouseDown);
  c.addEventListener('mouseup', scanOnMouseUp);
  c.addEventListener('wheel', scanOnWheel, { passive: false });
  window.addEventListener('resize', () => {
    c.width = wrap.clientWidth || 800;
    scanDraw();
  });
  scanUpdateCadEditorPanel();
}

// ── dosya seçimi ──
function scanFileSelected(input) {
  const f = input.files[0];
  if (!f) return;
  scanState.file = f;
  document.getElementById('scanDropFname').textContent = f.name;
  document.getElementById('scanDrop').classList.add('loaded');
  document.getElementById('scanConvertBtn').disabled = false;

  // Orijinal görsel önizleme (raster dosyalar için)
  const ext = f.name.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','bmp','tiff','tif'].includes(ext)) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('scanOriginalImg').src = e.target.result;
      document.getElementById('scanOriginalCard').style.display = '';
    };
    reader.readAsDataURL(f);
  } else {
    document.getElementById('scanOriginalCard').style.display = 'none';
  }
}

function scanDragOver(e) { e.preventDefault(); document.getElementById('scanDrop').classList.add('drag'); }
function scanDragLeave() { document.getElementById('scanDrop').classList.remove('drag'); }
function scanDrop_handler(e) {
  e.preventDefault();
  scanDragLeave();
  const f = e.dataTransfer.files[0];
  if (f) { document.getElementById('scanFileInput').files = e.dataTransfer.files; scanFileSelected(document.getElementById('scanFileInput')); }
}

// ── dönüştür ──
async function scanConvert() {
  if (!scanState.file) return;
  const btn = document.getElementById('scanConvertBtn');
  btn.disabled = true;
  scanMsg('Dönüştürülüyor...', '#0ea5e9');

  const fd = new FormData();
  fd.append('file', scanState.file);
  const foregroundMode = document.getElementById('scanForegroundMode')?.value || 'part';
  const params = new URLSearchParams({ foreground_mode: foregroundMode });

  try {
    await ensureApiBase();
    const res = await fetch(`${API}/scan/convert?${params.toString()}`, {
      method: 'POST',
      headers: authH(),
      body: fd,
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || res.statusText); }
    const data = await res.json();

    // Orijinal görsel önizleme (backend'den gelen annotated preview)
    if (data.preview) {
      document.getElementById('scanOriginalImg').src = data.preview;
      document.getElementById('scanOriginalCard').style.display = '';
    }

    scanState.entities = scanEnsureCadEntityCollections(data.entities);
    scanState.history = [];
    scanState.selectedIdx = null;

    // İstatistikler
    const e = scanState.entities;
    document.getElementById('sSLines').textContent = e.lines?.length || 0;
    document.getElementById('sSCircles').textContent = e.circles?.length || 0;
    document.getElementById('sSArcs').textContent = e.arcs?.length || 0;
    document.getElementById('sSTotal').textContent = data.entity_count;
    document.getElementById('scanStats').style.display = '';

    document.getElementById('scanExportBtn').disabled = false;
    document.getElementById('scanIndexBtn').disabled = false;
    document.getElementById('scanSmoothBtn').disabled = false;
    document.getElementById('scanCanvasEmpty').style.display = 'none';

    scanUpdateCadEditorPanel();
    scanFitView();
    const fg = data.foreground || {};
    const fgNote = fg.applied ? ' Parça konturu filtresi uygulandı.' : '';
    scanMsg(`${data.entity_count} entity tespit edildi.${fgNote}`, '#16a34a');
  } catch(err) {
    scanMsg('Hata: ' + err.message, '#dc2626');
  } finally {
    btn.disabled = false;
  }
}

// ── iyileştir (smooth) ──
async function scanSmooth() {
  if (!scanState.file) return;
  const btn = document.getElementById('scanSmoothBtn');
  btn.disabled = true;
  scanMsg('İyileştiriliyor...', '#7c3aed');

  const fd = new FormData();
  fd.append('file', scanState.file);
  const foregroundMode = document.getElementById('scanForegroundMode')?.value || 'part';
  const params = new URLSearchParams({ smooth: 'true', foreground_mode: foregroundMode });

  try {
    await ensureApiBase();
    const res = await fetch(`${API}/scan/convert?${params.toString()}`, {
      method: 'POST',
      headers: authH(),
      body: fd,
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || res.statusText); }
    const data = await res.json();

    if (data.preview) document.getElementById('scanOriginalImg').src = data.preview;

    scanState.entities = scanEnsureCadEntityCollections(data.entities);
    scanState.history = [];
    scanState.selectedIdx = null;

    const e = scanState.entities;
    document.getElementById('sSLines').textContent = e.lines?.length || 0;
    document.getElementById('sSCircles').textContent = e.circles?.length || 0;
    document.getElementById('sSArcs').textContent = e.arcs?.length || 0;
    document.getElementById('sSTotal').textContent = data.entity_count;

    btn.classList.add('active');
    scanUpdateCadEditorPanel();
    scanFitView();
    scanMsg('İyileştirme tamamlandı.', '#7c3aed');
  } catch(err) {
    scanMsg('Hata: ' + err.message, '#dc2626');
  } finally {
    btn.disabled = false;
  }
}

// ── canvas çizim ──
function scanDraw() {
  const { canvas, ctx, entities, zoom, pan, selectedIdx, tool, drawing, drawStart } = scanState;
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#f0f4f8';
  ctx.lineWidth = 1;
  const gridStep = 50 * zoom;
  for (let x = (pan.x % gridStep); x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = (pan.y % gridStep); y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  if (!entities) return;

  const toScreen = (cx, cy) => ({
    x: cx * zoom + pan.x,
    y: H - (cy * zoom + pan.y),
  });

  const isSelected = (type, i) => selectedIdx && selectedIdx.type === type && selectedIdx.index === i;

  // Çizgiler
  (entities.lines || []).forEach((l, i) => {
    const s = toScreen(l.x1, l.y1), e2 = toScreen(l.x2, l.y2);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(e2.x, e2.y);
    ctx.strokeStyle = isSelected('line', i) ? '#f59e0b' : '#0ea5e9';
    ctx.lineWidth = isSelected('line', i) ? 2.5 : 1.5;
    ctx.stroke();
  });

  // Çemberler
  (entities.circles || []).forEach((c, i) => {
    const sc = toScreen(c.cx, c.cy);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, c.r * zoom, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected('circle', i) ? '#f59e0b' : '#e11d48';
    ctx.lineWidth = isSelected('circle', i) ? 2.5 : 1.5;
    ctx.stroke();
  });

  // Yaylar
  (entities.arcs || []).forEach((a, i) => {
    const sc = toScreen(a.cx, a.cy);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, a.r * zoom,
      -a.end_angle * Math.PI / 180,
      -a.start_angle * Math.PI / 180);
    ctx.strokeStyle = isSelected('arc', i) ? '#f59e0b' : '#7c3aed';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Spline'lar (potrace bezier eğrileri)
  (entities.splines || []).forEach((sp, i) => {
    const pts = sp.points;
    if (!pts || pts.length < 2) return;
    const s0 = toScreen(pts[0].x, pts[0].y);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    if (pts.length === 4) {
      const c1 = toScreen(pts[1].x, pts[1].y);
      const c2 = toScreen(pts[2].x, pts[2].y);
      const e2 = toScreen(pts[3].x, pts[3].y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e2.x, e2.y);
    } else if (pts.length === 3) {
      const c1 = toScreen(pts[1].x, pts[1].y);
      const e2 = toScreen(pts[2].x, pts[2].y);
      ctx.quadraticCurveTo(c1.x, c1.y, e2.x, e2.y);
    } else {
      pts.slice(1).forEach(p => { const sc2 = toScreen(p.x, p.y); ctx.lineTo(sc2.x, sc2.y); });
    }
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Aktif çizim önizlemesi
  if (drawing && drawStart) {
    const mp = scanState._mousePos || drawStart;
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    if (tool === 'line') {
      ctx.beginPath(); ctx.moveTo(drawStart.x, drawStart.y); ctx.lineTo(mp.x, mp.y); ctx.stroke();
    } else if (tool === 'circle') {
      const r = Math.hypot(mp.x - drawStart.x, mp.y - drawStart.y);
      ctx.beginPath(); ctx.arc(drawStart.x, drawStart.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  document.getElementById('scanStatusZoom').textContent = `Zoom: ${Math.round(zoom*100)}%`;

  // SVG görünümü açıksa onu da senkronize et
  if (scanState.svgMode) scanRenderSVG();
}

// ── koordinat dönüşümleri ──
function screenToWorld(sx, sy) {
  const H = scanState.canvas.height;
  return {
    x: (sx - scanState.pan.x) / scanState.zoom,
    y: (H - sy - scanState.pan.y) / scanState.zoom,
  };
}

// ── mouse olayları ──
function scanOnMouseMove(e) {
  const r = scanState.canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const w = screenToWorld(mx, my);
  document.getElementById('scanStatusCoords').textContent = `X: ${w.x.toFixed(1)} Y: ${w.y.toFixed(1)}`;
  scanState._mousePos = { x: mx, y: my };

  // Move aracı ile sürükleme
  if (scanState.dragging && scanState.selectedIdx && scanState.dragStart) {
    const sel = scanState.selectedIdx;
    const dx = w.x - scanState.dragStart.x, dy = w.y - scanState.dragStart.y;
    const list = scanState.entities[sel.type + 's'];
    if (list && list[sel.index]) {
      const ent = list[sel.index];
      if (sel.type === 'line') {
        ent.x1 += dx; ent.y1 += dy; ent.x2 += dx; ent.y2 += dy;
      } else if (sel.type === 'circle' || sel.type === 'arc') {
        ent.cx += dx; ent.cy += dy;
      }
    }
    scanState.dragStart = w;
    scanDraw();
    return;
  }

  if (scanState.drawing) scanDraw();
}

function scanOnMouseDown(e) {
  const r = scanState.canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;

  if (scanState.tool === 'select' || scanState.tool === 'move') {
    // Hit test
    const w = screenToWorld(mx, my);
    let hit = null;
    const ents = scanState.entities;
    if (ents) {
      (ents.lines || []).forEach((l, i) => {
        const dist = pointToSegmentDist(w.x, w.y, l.x1, l.y1, l.x2, l.y2);
        if (dist < 6 / scanState.zoom) hit = { type: 'line', index: i };
      });
      (ents.circles || []).forEach((c, i) => {
        const d = Math.hypot(w.x - c.cx, w.y - c.cy);
        if (Math.abs(d - c.r) < 6 / scanState.zoom) hit = { type: 'circle', index: i };
      });
      (ents.arcs || []).forEach((a, i) => {
        const d = Math.hypot(w.x - a.cx, w.y - a.cy);
        if (Math.abs(d - a.r) < 6 / scanState.zoom) hit = { type: 'arc', index: i };
      });
    }
    scanState.selectedIdx = hit;
    document.getElementById('scanStatusSel').textContent = hit ? `${hit.type} #${hit.index}` : '—';

    // Move aracı için sürükleme başlat
    if (scanState.tool === 'move' && hit) {
      scanState.dragging = true;
      scanState.dragStart = w;
      scanSaveHistory();
    }
    scanDraw();
    return;
  }

  // Arc: 3-nokta biriktir
  if (scanState.tool === 'arc') {
    const w = screenToWorld(mx, my);
    if (!scanState.arcPoints) scanState.arcPoints = [];
    scanState.arcPoints.push({ x: w.x, y: w.y });
    if (scanState.arcPoints.length === 3) {
      const arc = threePointArc(scanState.arcPoints[0], scanState.arcPoints[1], scanState.arcPoints[2]);
      if (arc) {
        scanState.entities = scanEnsureCadEntityCollections(scanState.entities);
        scanSaveHistory();
        scanState.entities.arcs.push({ type:'ARC', cx: arc.cx, cy: arc.cy, r: arc.r, start_angle: arc.start, end_angle: arc.end });
        document.getElementById('scanExportBtn').disabled = false;
        scanUpdateCadEditorPanel();
      }
      scanState.arcPoints = [];
    }
    scanDraw();
    return;
  }

  scanState.drawing = true;
  scanState.drawStart = { x: mx, y: my };
}

// 3 noktadan geçen çember/yay hesabı
function threePointArc(p1, p2, p3) {
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const ux = ((ax*ax + ay*ay) * (by - cy) + (bx*bx + by*by) * (cy - ay) + (cx*cx + cy*cy) * (ay - by)) / d;
  const uy = ((ax*ax + ay*ay) * (cx - bx) + (bx*bx + by*by) * (ax - cx) + (cx*cx + cy*cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a1 = Math.atan2(ay - uy, ax - ux) * 180 / Math.PI;
  const a3 = Math.atan2(cy - uy, cx - ux) * 180 / Math.PI;
  return { cx: ux, cy: uy, r, start: ((a1 % 360) + 360) % 360, end: ((a3 % 360) + 360) % 360 };
}

function scanOnMouseUp(e) {
  if (scanState.dragging) {
    scanState.dragging = false;
    scanState.dragStart = null;
    if (scanState.svgMode) scanRenderSVG();
    return;
  }
  if (!scanState.drawing) return;
  scanState.drawing = false;
  const r = scanState.canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;

  const ws = screenToWorld(scanState.drawStart.x, scanState.drawStart.y);
  const we = screenToWorld(mx, my);

  scanState.entities = scanEnsureCadEntityCollections(scanState.entities);

  scanSaveHistory();

  if (scanState.tool === 'line') {
    scanState.entities.lines.push({ type:'LINE', x1: ws.x, y1: ws.y, x2: we.x, y2: we.y });
  } else if (scanState.tool === 'circle') {
    const r = Math.hypot(we.x - ws.x, we.y - ws.y);
    if (r > 1) scanState.entities.circles.push({ type:'CIRCLE', cx: ws.x, cy: ws.y, r });
  }

  document.getElementById('scanExportBtn').disabled = false;
  scanUpdateCadEditorPanel();
  scanDraw();
}

function scanOnWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const r = scanState.canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  scanState.pan.x = mx - (mx - scanState.pan.x) * factor;
  scanState.pan.y = my - (my - scanState.pan.y) * factor;
  scanState.zoom *= factor;
  scanDraw();
}

// ── araçlar ──
function setTool(t) {
  scanState.tool = t;
  // Arc 3-nokta toplama için
  scanState.arcPoints = [];
  ['select','line','circle','arc','move'].forEach(id => {
    const btn = document.getElementById('tool' + id.charAt(0).toUpperCase() + id.slice(1));
    if (btn) btn.classList.toggle('active', id === t);
  });
  const labels = { select:'Seç', line:'Çizgi', circle:'Çember', arc:'Yay (3 nokta)', move:'Taşı' };
  document.getElementById('scanStatusTool').textContent = 'Araç: ' + (labels[t] || t);
  if (scanState.canvas) scanState.canvas.style.cursor = (t === 'select' || t === 'move') ? 'default' : 'crosshair';
  if (scanState.svgMode) scanRenderSVG();
}

function scanZoom(f) {
  const W = scanState.canvas.width / 2, H = scanState.canvas.height / 2;
  scanState.pan.x = W - (W - scanState.pan.x) * f;
  scanState.pan.y = H - (H - scanState.pan.y) * f;
  scanState.zoom *= f;
  scanDraw();
}

function scanFitView() {
  const e = scanState.entities;
  const W = scanState.canvas.width, H = scanState.canvas.height;
  if (!e) return;

  // Gerçek bbox'ı tüm entity'lerden hesapla
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (e.lines || []).forEach(l => {
    minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2);
    minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2);
  });
  (e.circles || []).forEach(c => {
    minX = Math.min(minX, c.cx - c.r); maxX = Math.max(maxX, c.cx + c.r);
    minY = Math.min(minY, c.cy - c.r); maxY = Math.max(maxY, c.cy + c.r);
  });
  (e.splines || []).forEach(sp => {
    (sp.points || []).forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
  });

  if (!isFinite(minX)) return;

  const ew = maxX - minX, eh = maxY - minY;
  if (ew < 1 || eh < 1) return;

  const margin = 40;
  const zoom = Math.min((W - margin * 2) / ew, (H - margin * 2) / eh);
  scanState.zoom = zoom;

  // Entity merkezi canvas ortasına gelsin
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  scanState.pan.x = W / 2 - cx * zoom;
  scanState.pan.y = H / 2 - cy * zoom;

  scanDraw();
}

// ── undo ──
function scanSaveHistory() {
  scanState.history.push(JSON.stringify(scanState.entities));
  if (scanState.history.length > 50) scanState.history.shift();
}

function scanUndo() {
  if (!scanState.history.length) return;
  scanState.entities = scanEnsureCadEntityCollections(JSON.parse(scanState.history.pop()));
  scanUpdateCadEditorPanel();
  if (scanState.svgMode) scanRenderSVG(); else scanDraw();
}

// ── sil ──
function scanDeleteSelected() {
  const sel = scanState.selectedIdx;
  if (!sel || !scanState.entities) return;
  scanSaveHistory();
  scanState.entities[sel.type + 's'].splice(sel.index, 1);
  scanState.selectedIdx = null;
  document.getElementById('scanStatusSel').textContent = '—';
  scanUpdateCadEditorPanel();
  if (scanState.svgMode) scanRenderSVG(); else scanDraw();
}

// ═══════════════════════════════════════════════════════
// TEKNİK ÇİZİM (SVG) GÖRÜNÜMÜ
// Canvas ile aynı scanState.entities'i kullanır — bidirectional
// ═══════════════════════════════════════════════════════
function toggleScanView() {
  scanState.svgMode = !scanState.svgMode;
  const canvas = document.getElementById('scanCanvas');
  const svgLayer = document.getElementById('scanSvgLayer');
  const btn = document.getElementById('scanViewToggleBtn');
  const dlBtn = document.getElementById('scanDownloadSvgBtn');
  if (scanState.svgMode) {
    canvas.style.display = 'none';
    svgLayer.style.display = 'block';
    btn.textContent = 'Canvas';
    btn.title = 'Canvas görünümüne dön';
    if (dlBtn) dlBtn.style.display = '';
    scanRenderSVG();
  } else {
    canvas.style.display = '';
    svgLayer.style.display = 'none';
    btn.textContent = 'SVG';
    btn.title = 'Teknik çizim (SVG) görünümüne geç';
    if (dlBtn) dlBtn.style.display = 'none';
    scanDraw();
  }
}

function scanRenderSVG() {
  const layer = document.getElementById('scanSvgLayer');
  if (!layer) return;
  const e = scanState.entities;
  if (!e) {
    layer.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">Dosya yükleyip Dönüştür\'e basın</div>';
    return;
  }

  // BBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (e.lines || []).forEach(l => {
    minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2);
    minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2);
  });
  (e.circles || []).forEach(c => {
    minX = Math.min(minX, c.cx - c.r); maxX = Math.max(maxX, c.cx + c.r);
    minY = Math.min(minY, c.cy - c.r); maxY = Math.max(maxY, c.cy + c.r);
  });
  (e.arcs || []).forEach(a => {
    minX = Math.min(minX, a.cx - a.r); maxX = Math.max(maxX, a.cx + a.r);
    minY = Math.min(minY, a.cy - a.r); maxY = Math.max(maxY, a.cy + a.r);
  });
  (e.splines || []).forEach(sp => {
    (sp.points || []).forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
  });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = e.width || 500; maxY = e.height || 500; }

  const pad = 30;
  const w = (maxX - minX) || 100, h = (maxY - minY) || 100;
  const viewX = minX - pad, viewY = minY - pad;
  const viewW = w + pad * 2, viewH = h + pad * 2;

  // SVG Y ekseni ters — tüm geometriyi transform ile flipliyoruz (gerçek teknik çizim gibi)
  // viewBox: sol-alt orijin; SVG'de üst sol orijin olduğu için flip

  const sel = scanState.selectedIdx;
  const isSel = (type, i) => sel && sel.type === type && sel.index === i;

  const mkLine = (l, i) => {
    const hi = isSel('line', i);
    return `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"
              stroke="${hi ? '#f59e0b' : '#1e293b'}"
              stroke-width="${hi ? 1.2 : 0.6}"
              stroke-linecap="round"
              data-type="line" data-i="${i}"
              style="cursor:pointer" />`;
  };
  const mkCircle = (c, i) => {
    const hi = isSel('circle', i);
    return `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"
              fill="none"
              stroke="${hi ? '#f59e0b' : '#b91c1c'}"
              stroke-width="${hi ? 1.2 : 0.6}"
              data-type="circle" data-i="${i}"
              style="cursor:pointer" />`;
  };
  const mkArc = (a, i) => {
    const hi = isSel('arc', i);
    const rad = v => v * Math.PI / 180;
    const sx = a.cx + a.r * Math.cos(rad(a.start_angle || 0));
    const sy = a.cy + a.r * Math.sin(rad(a.start_angle || 0));
    const ex = a.cx + a.r * Math.cos(rad(a.end_angle || 0));
    const ey = a.cy + a.r * Math.sin(rad(a.end_angle || 0));
    let sweep = ((a.end_angle || 0) - (a.start_angle || 0));
    sweep = ((sweep % 360) + 360) % 360;
    const largeArc = sweep > 180 ? 1 : 0;
    return `<path d="M ${sx} ${sy} A ${a.r} ${a.r} 0 ${largeArc} 1 ${ex} ${ey}"
              fill="none"
              stroke="${hi ? '#f59e0b' : '#6d28d9'}"
              stroke-width="${hi ? 1.2 : 0.6}"
              data-type="arc" data-i="${i}"
              style="cursor:pointer" />`;
  };
  const mkSpline = (sp, i) => {
    const pts = sp.points || [];
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    if (pts.length === 4) d += ` C ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y} ${pts[3].x} ${pts[3].y}`;
    else if (pts.length === 3) d += ` Q ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y}`;
    else d += pts.slice(1).map(p => ` L ${p.x} ${p.y}`).join('');
    return `<path d="${d}" fill="none" stroke="#6d28d9" stroke-width="0.6" data-type="spline" data-i="${i}" />`;
  };

  // Izgara (5 ve 25 birim kademeli, gerçek teknik çizim görünümü)
  const gridMinor = Math.max(5, Math.round(Math.max(viewW, viewH) / 100));
  const gridMajor = gridMinor * 5;

  const svgStr = `
    <svg id="scanSvg" xmlns="http://www.w3.org/2000/svg"
         viewBox="${viewX} ${viewY} ${viewW} ${viewH}"
         preserveAspectRatio="xMidYMid meet"
         style="width:100%;height:100%;display:block;background:#fdfdfd"
         onmousedown="scanSvgMouseDown(event)"
         onmousemove="scanSvgMouseMove(event)"
         onmouseup="scanSvgMouseUp(event)">
      <defs>
        <pattern id="gridMinor" width="${gridMinor}" height="${gridMinor}" patternUnits="userSpaceOnUse">
          <path d="M ${gridMinor} 0 L 0 0 0 ${gridMinor}" fill="none" stroke="#eef2f7" stroke-width="0.15"/>
        </pattern>
        <pattern id="gridMajor" width="${gridMajor}" height="${gridMajor}" patternUnits="userSpaceOnUse">
          <rect width="${gridMajor}" height="${gridMajor}" fill="url(#gridMinor)"/>
          <path d="M ${gridMajor} 0 L 0 0 0 ${gridMajor}" fill="none" stroke="#d6dde6" stroke-width="0.3"/>
        </pattern>
        <marker id="axisArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/>
        </marker>
      </defs>
      <rect x="${viewX}" y="${viewY}" width="${viewW}" height="${viewH}" fill="url(#gridMajor)"/>
      <!-- Eksen çizgileri (X yatay, Y dikey — Y ters SVG'de) -->
      <g transform="translate(0 ${minY + maxY}) scale(1 -1)">
        <!-- X ekseni -->
        <line x1="${viewX}" y1="0" x2="${viewX + viewW}" y2="0" stroke="#94a3b8" stroke-width="0.25" stroke-dasharray="2 2"/>
        <!-- Y ekseni -->
        <line x1="0" y1="${viewY}" x2="0" y2="${viewY + viewH}" stroke="#94a3b8" stroke-width="0.25" stroke-dasharray="2 2"/>
        <!-- Tüm entity'ler burada — flipped koordinat sisteminde çizilir -->
        ${(e.lines || []).map(mkLine).join('')}
        ${(e.circles || []).map(mkCircle).join('')}
        ${(e.arcs || []).map(mkArc).join('')}
        ${(e.splines || []).map(mkSpline).join('')}
      </g>
      <!-- Sol üstte ölçek + boyut etiketi -->
      <g font-family="DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${Math.max(viewW, viewH) / 90}" fill="#64748b">
        <text x="${viewX + 4}" y="${viewY + Math.max(viewW, viewH) / 45}">
          ${w.toFixed(1)} × ${h.toFixed(1)} · ${e.lines?.length||0} L · ${e.circles?.length||0} C · ${e.arcs?.length||0} A
        </text>
      </g>
    </svg>
  `;
  layer.innerHTML = svgStr;
}

function scanSvgMouseDown(ev) {
  const target = ev.target;
  const t = target.getAttribute && target.getAttribute('data-type');
  const i = target.getAttribute && target.getAttribute('data-i');
  if (t && i !== null) {
    scanState.selectedIdx = { type: t, index: parseInt(i, 10) };
    document.getElementById('scanStatusSel').textContent = `${t} #${i}`;
    if (scanState.tool === 'move') {
      scanState.dragging = true;
      const w = scanSvgClientToWorld(ev);
      scanState.dragStart = w;
      scanSaveHistory();
    }
    scanRenderSVG();
    return;
  }
  // Boş alana tıklandı — aracın türüne göre çizim başlat
  const w = scanSvgClientToWorld(ev);
  if (scanState.tool === 'line' || scanState.tool === 'circle') {
    scanState.drawing = true;
    scanState.drawStart = w;
  } else if (scanState.tool === 'arc') {
    if (!scanState.arcPoints) scanState.arcPoints = [];
    scanState.arcPoints.push(w);
    if (scanState.arcPoints.length === 3) {
      const arc = threePointArc(scanState.arcPoints[0], scanState.arcPoints[1], scanState.arcPoints[2]);
      if (arc) {
        if (!scanState.entities.arcs) scanState.entities.arcs = [];
        scanSaveHistory();
        scanState.entities.arcs.push({ type:'ARC', cx: arc.cx, cy: arc.cy, r: arc.r, start_angle: arc.start, end_angle: arc.end });
        scanUpdateCadEditorPanel();
      }
      scanState.arcPoints = [];
      scanRenderSVG();
    }
  } else if (scanState.tool === 'select') {
    scanState.selectedIdx = null;
    document.getElementById('scanStatusSel').textContent = '—';
    scanRenderSVG();
  }
}

function scanSvgMouseMove(ev) {
  const w = scanSvgClientToWorld(ev);
  document.getElementById('scanStatusCoords').textContent = `X: ${w.x.toFixed(1)} Y: ${w.y.toFixed(1)}`;
  if (scanState.dragging && scanState.selectedIdx && scanState.dragStart) {
    const sel = scanState.selectedIdx;
    const dx = w.x - scanState.dragStart.x, dy = w.y - scanState.dragStart.y;
    const list = scanState.entities[sel.type + 's'];
    if (list && list[sel.index]) {
      const ent = list[sel.index];
      if (sel.type === 'line') { ent.x1 += dx; ent.y1 += dy; ent.x2 += dx; ent.y2 += dy; }
      else if (sel.type === 'circle' || sel.type === 'arc') { ent.cx += dx; ent.cy += dy; }
    }
    scanState.dragStart = w;
    scanRenderSVG();
  }
}

function scanSvgMouseUp(ev) {
  if (scanState.dragging) {
    scanState.dragging = false;
    scanState.dragStart = null;
    return;
  }
  if (scanState.drawing && scanState.drawStart) {
    const w = scanSvgClientToWorld(ev);
    scanState.entities = scanEnsureCadEntityCollections(scanState.entities);
    scanSaveHistory();
    if (scanState.tool === 'line') {
      scanState.entities.lines.push({ type:'LINE', x1: scanState.drawStart.x, y1: scanState.drawStart.y, x2: w.x, y2: w.y });
    } else if (scanState.tool === 'circle') {
      const r = Math.hypot(w.x - scanState.drawStart.x, w.y - scanState.drawStart.y);
      if (r > 0.5) scanState.entities.circles.push({ type:'CIRCLE', cx: scanState.drawStart.x, cy: scanState.drawStart.y, r });
    }
    scanState.drawing = false;
    scanState.drawStart = null;
    document.getElementById('scanExportBtn').disabled = false;
    scanUpdateCadEditorPanel();
    scanRenderSVG();
  }
}

function scanSvgClientToWorld(ev) {
  const svg = document.getElementById('scanSvg');
  if (!svg) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const loc = pt.matrixTransform(ctm.inverse());
  // SVG'de flip yaptığımız için y'yi ters çevir
  const e = scanState.entities || {};
  // inner <g> transform="translate(0 (minY+maxY)) scale(1 -1)" uyguluyor
  // dolayısıyla world y = (minY+maxY) - svg_local_y
  let minY = Infinity, maxY = -Infinity;
  (e.lines || []).forEach(l => { minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2); });
  (e.circles || []).forEach(c => { minY = Math.min(minY, c.cy - c.r); maxY = Math.max(maxY, c.cy + c.r); });
  (e.arcs || []).forEach(a => { minY = Math.min(minY, a.cy - a.r); maxY = Math.max(maxY, a.cy + a.r); });
  if (!isFinite(minY)) { minY = 0; maxY = e.height || 500; }
  return { x: loc.x, y: (minY + maxY) - loc.y };
}

function scanDownloadSvg() {
  const layer = document.getElementById('scanSvgLayer');
  if (!layer) return;
  const svg = layer.querySelector('svg');
  if (!svg) { alert('Önce SVG görünümünü açın.'); return; }
  const clone = svg.cloneNode(true);
  clone.removeAttribute('onmousedown'); clone.removeAttribute('onmousemove'); clone.removeAttribute('onmouseup');
  clone.querySelectorAll('[onclick],[onmousedown]').forEach(el => { el.removeAttribute('onclick'); el.removeAttribute('onmousedown'); });
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
  const blob = new Blob([str], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = (scanState.file?.name.replace(/\.[^.]+$/, '') || 'scan_output') + '.svg';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

// ── export DXF ──
async function scanExportDXF() {
  if (!scanState.entities) return;
  try {
    await ensureApiBase();
    // Yeni entity tipleri (polyline/rect/polygon/dimension) backend'e uyumsuz —
    // acadFlattenForExport ile line/circle/arc/text'e düzleştiriyoruz.
    const payload = (typeof acadFlattenForExport === 'function') ? acadFlattenForExport() : scanState.entities;
    const res = await fetch(`${API}/scan/export-dxf`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entities: payload,
        filename: (scanState.file?.name.replace(/\.[^.]+$/, '') || 'scan_output') + '.dxf',
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'scan_output.dxf'; a.click();
    URL.revokeObjectURL(url);
  } catch(err) {
    scanMsg('Export hatası: ' + err.message, '#dc2626');
  }
}

// ── arşive ekle ──
async function scanIndexFile() {
  if (!scanState.entities || !scanState.file) return;
  scanMsg('Arşive ekleniyor...', '#0ea5e9');
  try {
    await ensureApiBase();
    // Önce DXF üret, sonra /index'e gönder
    const exportPayload = (typeof acadFlattenForExport === 'function') ? acadFlattenForExport() : scanState.entities;
    const exportRes = await fetch(`${API}/scan/export-dxf`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ entities: exportPayload,
        filename: (scanState.file?.name.replace(/\.[^.]+$/, '') || 'scan') + '.dxf' }),
    });
    if (!exportRes.ok) throw new Error('DXF üretilemedi');
    const dxfBlob = await exportRes.blob();
    const dxfName = (scanState.file.name.replace(/\.[^.]+$/, '') || 'scan') + '_scan.dxf';
    const fd = new FormData();
    fd.append('file', new File([dxfBlob], dxfName, { type: 'application/dxf' }));
    fd.append('skip_clip', 'false');
    const idxRes = await fetch(`${API}/index?skip_clip=false`, {
      method: 'POST', headers: authH(), body: fd,
    });
    if (!idxRes.ok) throw new Error((await idxRes.json()).detail || 'Index hatası');
    scanMsg('Arşive eklendi!', '#16a34a');
  } catch(err) {
    scanMsg('Hata: ' + err.message, '#dc2626');
  }
}

// ── reset ──
function scanReset() {
  scanState.file = null;
  scanState.entities = null;
  scanState.history = [];
  scanState.selectedIdx = null;
  document.getElementById('scanFileInput').value = '';
  document.getElementById('scanDropFname').textContent = '';
  document.getElementById('scanDrop').classList.remove('loaded');
  document.getElementById('scanConvertBtn').disabled = true;
  document.getElementById('scanSmoothBtn').disabled = true;
  document.getElementById('scanSmoothBtn').classList.remove('active');
  document.getElementById('scanExportBtn').disabled = true;
  document.getElementById('scanIndexBtn').disabled = true;
  document.getElementById('scanStats').style.display = 'none';
  document.getElementById('scanOriginalCard').style.display = 'none';
  document.getElementById('scanCanvasEmpty').style.display = '';
  scanMsg('');
  if (scanState.ctx) scanState.ctx.clearRect(0, 0, scanState.canvas.width, scanState.canvas.height);
  const svgLayer = document.getElementById('scanSvgLayer');
  if (svgLayer) svgLayer.innerHTML = '';
  scanState.arcPoints = [];
  scanState.dragging = false;
  scanState.dragStart = null;
  scanUpdateCadEditorPanel();
}

function scanMsg(txt, color = '') {
  const el = document.getElementById('scanMsg');
  el.textContent = txt;
  el.style.color = color;
}

// ── yardımcı: nokta-segment mesafesi ──
function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px-ax, py-ay);
  let t = ((px-ax)*dx + (py-ay)*dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}
