// ═══════════════════════════════════════════════════════════════════════════
// CAD PRO — AutoCAD-tarzı tam editör
// State + render + snap + tools + layers + command line + keyboard
// ═══════════════════════════════════════════════════════════════════════════

const acadState = {
  open: false,
  // Görüntü
  zoom: 1, pan: { x: 0, y: 0 },
  width: 800, height: 600,   // canvas görünür boyutu
  // Modlar
  osnap: true, ortho: false, gridSnap: false,
  gridSize: 10,
  snapTol: 12,               // piksel cinsinden snap hassasiyet
  // Araç ve komut
  tool: 'select',
  cmdPrompt: 'Komut:',
  cmdHistory: [],
  pending: null,             // { type, step, points: [...], extra... }
  lastTool: null,            // Enter ile tekrarlamak için
  // Veri
  layers: [],                // [{ name, color, visible, locked }]
  currentLayer: '0',
  selection: [],             // [{type, index}]
  // Önbellekler
  hoverSnap: null,           // {x, y, kind}
  mouseWorld: { x: 0, y: 0 },
  mouseScreen: { x: 0, y: 0 },
  // Geri al / ileri al
  undoStack: [],
  redoStack: [],
};

const ACAD_DEFAULT_LAYERS = [
  { name: '0',           color: '#ffffff', visible: true, locked: false },
  { name: 'CIZGI',       color: '#ffb400', visible: true, locked: false },
  { name: 'INSAAT',      color: '#3b82f6', visible: true, locked: false },
  { name: 'OLCU',        color: '#22c55e', visible: true, locked: false },
  { name: 'YARDIMCI',    color: '#94a3b8', visible: true, locked: false },
];

// ─── Açılış / kapanış ───────────────────────────────────────────────
function openAcad() {
  if (!scanState.entities) {
    scanState.entities = scanEnsureCadEntityCollections({ width: 500, height: 500 });
  } else {
    scanState.entities = scanEnsureCadEntityCollections(scanState.entities);
  }
  // Layers init: scanState.entities'da layers yoksa default'larla başla
  if (!scanState._acadLayers) scanState._acadLayers = ACAD_DEFAULT_LAYERS.map(l => ({ ...l }));
  acadState.layers = scanState._acadLayers;
  acadState.currentLayer = acadState.layers[0]?.name || '0';
  acadState.open = true;
  document.getElementById('acadOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  acadResize();
  acadFit();
  acadRenderLayers();
  acadUpdateModeButtons();
  acadUpdateSelectionInfo();
  acadRender();
  acadLog('CAD Pro yüklendi. Komut yazabilir veya araç seçebilirsiniz. Koordinat: x,y · @dx,dy · mesafe<açı. (F1=yardım)', 'cmd-ok');
  setTimeout(() => document.getElementById('acadCmdInput').focus(), 50);
  requestAnimationFrame(() => {
    acadResize();
    acadFit();
    acadRender();
  });
  window.addEventListener('keydown', acadKeydown, true);
  window.addEventListener('resize', acadResize);
}

function closeAcad() {
  acadState.open = false;
  document.getElementById('acadOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  window.removeEventListener('keydown', acadKeydown, true);
  window.removeEventListener('resize', acadResize);
  // Mevcut canvas görünümüne geri dön
  if (scanState.svgMode) scanRenderSVG(); else scanDraw();
  scanUpdateCadEditorPanel();
}

function acadResize() {
  const area = document.getElementById('acadCanvasArea');
  if (!area) return;
  const r = area.getBoundingClientRect();
  acadState.width = Math.max(r.width || 0, 600);
  acadState.height = Math.max(r.height || 0, 420);
  const svg = document.getElementById('acadSvg');
  svg.setAttribute('width', acadState.width);
  svg.setAttribute('height', acadState.height);
  acadRender();
}

// ─── Komut günlüğü ──────────────────────────────────────────────────
function acadLog(msg, cls = '') {
  const el = document.getElementById('acadCmdHistory');
  if (!el) return;
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function acadSetPrompt(text) {
  acadState.cmdPrompt = text;
  document.getElementById('acadCmdPrompt').textContent = text;
}

// ─── Mod toggles ────────────────────────────────────────────────────
function acadToggle(mode) {
  acadState[mode] = !acadState[mode];
  acadUpdateModeButtons();
  acadRender();
}
function acadUpdateModeButtons() {
  document.getElementById('acadToggleOsnap').classList.toggle('on', acadState.osnap);
  document.getElementById('acadToggleOrtho').classList.toggle('on', acadState.ortho);
  document.getElementById('acadToggleGrid').classList.toggle('on', acadState.gridSnap);
  document.getElementById('acadStatusModes').textContent =
    `${acadState.osnap?'OSNAP':'osnap'} · ${acadState.ortho?'ORTHO':'ortho'} · ${acadState.gridSnap?'GSNAP':'gsnap'}`;
}

function acadUpdateDocInfo(visibleCount = null) {
  const nameEl = document.getElementById('acadDocName');
  const metaEl = document.getElementById('acadDocMeta');
  if (!nameEl || !metaEl) return;
  const total = scanEntityCounts().total;
  const fileName = scanState.file?.name || t('acad.untitled');
  nameEl.textContent = fileName;
  metaEl.textContent = `${total} entity${visibleCount != null && visibleCount !== total ? ` · ${visibleCount} ${t('acad.visible')}` : ''}`;
}

function acadUpdateEmptyState() {
  const empty = document.getElementById('acadEmptyState');
  if (!empty) return;
  const hasEntities = scanEntityCounts().total > 0;
  empty.classList.toggle('show', !hasEntities && !acadState.pending);
}

function acadOpenScanUpload() {
  closeAcad();
  toggleDigitalMenu(true);
  const nav = document.getElementById('nav-scan');
  if (nav) setActiveNav(nav);
  switchTab('scan');
  setTimeout(() => document.getElementById('scanFileInput')?.click(), 80);
}

function acadStartBlankDrawing() {
  scanState.entities = scanEnsureCadEntityCollections(scanState.entities || { width: 500, height: 500 });
  acadSetTool('line');
  acadUpdateEmptyState();
  acadRender();
}

// ─── Koordinat dönüşümleri ──────────────────────────────────────────
function acadW2S(wx, wy) {
  return { x: wx * acadState.zoom + acadState.pan.x, y: acadState.height - (wy * acadState.zoom + acadState.pan.y) };
}
function acadS2W(sx, sy) {
  return { x: (sx - acadState.pan.x) / acadState.zoom, y: (acadState.height - sy - acadState.pan.y) / acadState.zoom };
}
function acadSvgPt(ev) {
  const r = document.getElementById('acadSvg').getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

// ─── Tüm entity'leri layer-aware iter ──────────────────────────────
function acadAllEntities(includeHidden = false) {
  const e = scanState.entities; if (!e) return [];
  const out = [];
  const layerVisible = (name) => {
    if (includeHidden) return true;
    const L = acadState.layers.find(x => x.name === (name || acadState.currentLayer));
    return !L || L.visible;
  };
  (e.lines || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'line', index: i }); });
  (e.circles || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'circle', index: i }); });
  (e.arcs || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'arc', index: i }); });
  (e.splines || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'spline', index: i }); });
  (e.polylines || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'polyline', index: i }); });
  (e.rectangles || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'rectangle', index: i }); });
  (e.polygons || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'polygon', index: i }); });
  (e.dimensions || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'dimension', index: i }); });
  (e.ellipses || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'ellipse', index: i }); });
  (e.points || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'point', index: i }); });
  (e.texts || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'text', index: i }); });
  (e.xlines || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'xline', index: i }); });
  (e.rays || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'ray', index: i }); });
  (e.leaders || []).forEach((it, i) => { if (layerVisible(it.layer)) out.push({ ent: it, type: 'leader', index: i }); });
  return out;
}

function acadLayerColor(layerName) {
  const L = acadState.layers.find(x => x.name === (layerName || acadState.currentLayer));
  return L?.color || '#ffffff';
}

// ─── Geri al / ileri al ─────────────────────────────────────────────
function acadSnapshot() {
  acadState.undoStack.push(JSON.stringify(scanState.entities));
  if (acadState.undoStack.length > 100) acadState.undoStack.shift();
  acadState.redoStack = [];
}
function acadUndo() {
  if (!acadState.undoStack.length) { acadLog('Geri alınacak işlem yok.', 'cmd-err'); return; }
  acadState.redoStack.push(JSON.stringify(scanState.entities));
  scanState.entities = scanEnsureCadEntityCollections(JSON.parse(acadState.undoStack.pop()));
  acadState.selection = [];
  acadRender();
  acadLog('Geri alındı.', 'cmd-ok');
}
function acadRedo() {
  if (!acadState.redoStack.length) { acadLog('İleri alınacak işlem yok.', 'cmd-err'); return; }
  acadState.undoStack.push(JSON.stringify(scanState.entities));
  scanState.entities = scanEnsureCadEntityCollections(JSON.parse(acadState.redoStack.pop()));
  acadState.selection = [];
  acadRender();
  acadLog('İleri alındı.', 'cmd-ok');
}

// ─── Ana render fonksiyonu ─────────────────────────────────────────
function acadRender() {
  const svg = document.getElementById('acadSvg');
  if (!svg || !acadState.open) return;
  const W = acadState.width, H = acadState.height;

  const parts = [];
  // Arka plan
  parts.push(`<rect width="${W}" height="${H}" fill="#1e2023"/>`);

  // Grid
  const gp = acadState.pan, gz = acadState.zoom;
  const gs = acadState.gridSize * gz;
  if (gs >= 4) {
    // Minor grid
    parts.push(`<g opacity="0.35">`);
    for (let x = gp.x % gs; x < W; x += gs) parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#2a2d33" stroke-width="0.5"/>`);
    for (let y = (-gp.y) % gs; y < H; y += gs) {
      const yy = H - y; parts.push(`<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" stroke="#2a2d33" stroke-width="0.5"/>`);
    }
    parts.push(`</g>`);
    // Major grid her 10 birimde bir
    const gs10 = gs * 10;
    if (gs10 >= 10) {
      parts.push(`<g opacity="0.55">`);
      for (let x = gp.x % gs10; x < W; x += gs10) parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#3a3d44" stroke-width="0.5"/>`);
      for (let y = (-gp.y) % gs10; y < H; y += gs10) {
        const yy = H - y; parts.push(`<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" stroke="#3a3d44" stroke-width="0.5"/>`);
      }
      parts.push(`</g>`);
    }
  }

  // Orijin haçı
  const o = acadW2S(0, 0);
  if (o.x >= -50 && o.x <= W + 50 && o.y >= -50 && o.y <= H + 50) {
    parts.push(`<line x1="${o.x - 14}" y1="${o.y}" x2="${o.x + 14}" y2="${o.y}" stroke="#ef4444" stroke-width="1.2"/>`);
    parts.push(`<line x1="${o.x}" y1="${o.y - 14}" x2="${o.x}" y2="${o.y + 14}" stroke="#22c55e" stroke-width="1.2"/>`);
    parts.push(`<text x="${o.x + 16}" y="${o.y - 4}" fill="#ef4444" font-size="9" font-family="DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">X</text>`);
    parts.push(`<text x="${o.x + 4}" y="${o.y - 16}" fill="#22c55e" font-size="9" font-family="DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">Y</text>`);
  }

  // Entity'leri çiz
  const all = acadAllEntities();
  const isSel = (type, index) => acadState.selection.some(s => s.type === type && s.index === index);

  all.forEach(({ ent, type, index }) => {
    const color = isSel(type, index) ? '#ffb400' : acadLayerColor(ent.layer);
    const sw = isSel(type, index) ? 1.8 : 1.0;
    parts.push(acadRenderEntity(ent, type, index, color, sw));
  });

  // Pending çizim önizlemesi
  if (acadState.pending && acadState.pending.preview) {
    parts.push(acadState.pending.preview());
  }

  // Fare haç işareti (crosshair)
  const m = acadState.mouseScreen;
  if (m && m.x != null) {
    parts.push(`<g opacity="0.35">`);
    parts.push(`<line x1="0" y1="${m.y}" x2="${W}" y2="${m.y}" stroke="#ffb400" stroke-width="0.4" stroke-dasharray="4 4"/>`);
    parts.push(`<line x1="${m.x}" y1="0" x2="${m.x}" y2="${H}" stroke="#ffb400" stroke-width="0.4" stroke-dasharray="4 4"/>`);
    parts.push(`</g>`);
    // Küçük pick-box
    parts.push(`<rect x="${m.x - 5}" y="${m.y - 5}" width="10" height="10" fill="none" stroke="#ffb400" stroke-width="0.8"/>`);
  }

  // Snap işareti
  if (acadState.hoverSnap) {
    const sp = acadW2S(acadState.hoverSnap.x, acadState.hoverSnap.y);
    parts.push(acadRenderSnapMarker(sp.x, sp.y, acadState.hoverSnap.kind));
  }

  svg.innerHTML = parts.join('');

  // Alt bar güncelleme
  document.getElementById('acadStatusZoom').textContent = `${Math.round(acadState.zoom * 100)}%`;
  document.getElementById('acadStatusTool').textContent = acadToolLabel(acadState.tool);
  document.getElementById('acadStatusLayer').textContent = acadState.currentLayer;
  const totalEnts = all.length;
  document.getElementById('acadEntityCount').textContent = `${totalEnts} entity · ${acadState.selection.length} seçili`;
  acadUpdateDocInfo(totalEnts);
  acadUpdateEmptyState();
  acadUpdateWorkbenchPanels(all);
}

function acadToolLabel(t) {
  const m = { select:'Seç', line:'Çizgi', circle:'Çember', arc:'Yay', rect:'Dikdörtgen', polyline:'Polyline', polygon:'Çokgen',
    move:'Taşı', copy:'Kopyala', rotate:'Döndür', erase:'Sil', trim:'Trim', extend:'Extend', offset:'Offset',
    'dim-lin':'Ölçü (Linear)', 'dim-ali':'Ölçü (Aligned)' };
  return m[t] || t;
}

function acadRenderEntity(ent, type, index, color, sw) {
  if (type === 'line') {
    const p1 = acadW2S(ent.x1, ent.y1), p2 = acadW2S(ent.x2, ent.y2);
    return `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  if (type === 'circle') {
    const c = acadW2S(ent.cx, ent.cy);
    return `<circle cx="${c.x}" cy="${c.y}" r="${ent.r * acadState.zoom}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
  }
  if (type === 'arc') {
    const rad = v => v * Math.PI / 180;
    const sw2 = ent.start_angle || 0, ew2 = ent.end_angle || 360;
    const sxw = ent.cx + ent.r * Math.cos(rad(sw2)), syw = ent.cy + ent.r * Math.sin(rad(sw2));
    const exw = ent.cx + ent.r * Math.cos(rad(ew2)), eyw = ent.cy + ent.r * Math.sin(rad(ew2));
    const ps = acadW2S(sxw, syw), pe = acadW2S(exw, eyw);
    let sweep = ((ew2 - sw2) % 360 + 360) % 360;
    const large = sweep > 180 ? 1 : 0;
    // SVG y-flip: sweep flag 0 (ters yönde) kullanıyoruz
    return `<path d="M ${ps.x} ${ps.y} A ${ent.r*acadState.zoom} ${ent.r*acadState.zoom} 0 ${large} 0 ${pe.x} ${pe.y}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
  }
  if (type === 'polyline') {
    const pts = (ent.points || []).map(p => acadW2S(p.x, p.y));
    if (pts.length < 2) return '';
    const d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ') + (ent.closed ? ' Z' : '');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (type === 'rectangle') {
    const p1 = acadW2S(ent.x1, ent.y1), p2 = acadW2S(ent.x2, ent.y2);
    const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
  }
  if (type === 'polygon') {
    const pts = (ent.points || []).map(p => acadW2S(p.x, p.y));
    const d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ') + ' Z';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
  }
  if (type === 'dimension') {
    return acadRenderDimension(ent, color, sw);
  }
  if (type === 'spline') {
    // Bezier kontrol noktaları (3 veya 4 nokta)
    const pts = (ent.points || []).map(p => acadW2S(p.x, p.y));
    if (pts.length < 2) return '';
    let d;
    if (pts.length === 4) {
      // Cubic bezier
      d = `M ${pts[0].x} ${pts[0].y} C ${pts[1].x} ${pts[1].y}, ${pts[2].x} ${pts[2].y}, ${pts[3].x} ${pts[3].y}`;
    } else if (pts.length === 3) {
      // Quadratic bezier
      d = `M ${pts[0].x} ${pts[0].y} Q ${pts[1].x} ${pts[1].y}, ${pts[2].x} ${pts[2].y}`;
    } else {
      // Düz polyline fallback
      d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  if (type === 'ellipse') {
    // Merkez + majorX/Y (yarı büyük eksen vektörü) + ratio (küçük/büyük eksen oranı)
    const c = acadW2S(ent.cx, ent.cy);
    const rx = Math.hypot(ent.mx, ent.my) * acadState.zoom;
    const ry = rx * (ent.ratio || 0.5);
    const rotDeg = Math.atan2(-ent.my, ent.mx) * 180 / Math.PI; // SVG y-flip
    return `<ellipse cx="${c.x}" cy="${c.y}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="${sw}" transform="rotate(${rotDeg} ${c.x} ${c.y})"/>`;
  }
  if (type === 'point') {
    const p = acadW2S(ent.x, ent.y);
    return `<g stroke="${color}" stroke-width="${sw}">` +
           `<line x1="${p.x-4}" y1="${p.y}" x2="${p.x+4}" y2="${p.y}"/>` +
           `<line x1="${p.x}" y1="${p.y-4}" x2="${p.x}" y2="${p.y+4}"/></g>`;
  }
  if (type === 'text') {
    const p = acadW2S(ent.x, ent.y);
    const h = (ent.height || 10) * acadState.zoom;
    const rot = ent.rotation || 0;
    const esc = String(ent.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<text x="${p.x}" y="${p.y}" fill="${color}" font-size="${h}" font-family="DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" transform="rotate(${-rot} ${p.x} ${p.y})">${esc}</text>`;
  }
  if (type === 'xline') {
    // Sonsuz çizgi: ekrandaki görünür alanı kapsayacak şekilde hesapla
    const W = acadState.width, H = acadState.height;
    const p1 = { x: ent.x, y: ent.y };
    const dx = Math.cos((ent.angle || 0) * Math.PI / 180);
    const dy = Math.sin((ent.angle || 0) * Math.PI / 180);
    // Büyük bir uzunluk ekle iki yöne
    const BIG = 1e6;
    const a = acadW2S(p1.x - dx * BIG, p1.y - dy * BIG);
    const b = acadW2S(p1.x + dx * BIG, p1.y + dy * BIG);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${sw}" stroke-dasharray="8 4" opacity="0.7"/>`;
  }
  if (type === 'ray') {
    // Yarı sonsuz — x,y noktasından (angle) yönünde
    const p1 = { x: ent.x, y: ent.y };
    const dx = Math.cos((ent.angle || 0) * Math.PI / 180);
    const dy = Math.sin((ent.angle || 0) * Math.PI / 180);
    const BIG = 1e6;
    const a = acadW2S(p1.x, p1.y);
    const b = acadW2S(p1.x + dx * BIG, p1.y + dy * BIG);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${sw}" stroke-dasharray="4 2" opacity="0.8"/>`;
  }
  if (type === 'leader') {
    // Ok + çizgi + metin. ent: {x1,y1 (ok ucu), x2,y2 (köşe), x3,y3 (metin noktası), text}
    const a = acadW2S(ent.x1, ent.y1), b = acadW2S(ent.x2, ent.y2), c = acadW2S(ent.x3, ent.y3);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const lx = a.x + 10 * Math.cos(ang + 0.3), ly = a.y + 10 * Math.sin(ang + 0.3);
    const rx = a.x + 10 * Math.cos(ang - 0.3), ry = a.y + 10 * Math.sin(ang - 0.3);
    const esc = String(ent.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<g stroke="${color}" stroke-width="${sw}" fill="${color}">` +
           `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" fill="none"/>` +
           `<line x1="${b.x}" y1="${b.y}" x2="${c.x}" y2="${c.y}" fill="none"/>` +
           `<polygon points="${a.x},${a.y} ${lx},${ly} ${rx},${ry}"/>` +
           `<text x="${c.x + 4}" y="${c.y - 2}" font-size="11" font-family="DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" stroke="none">${esc}</text></g>`;
  }
  return '';
}

function acadRenderDimension(ent, color, sw) {
  // ent: { x1,y1, x2,y2, ox,oy (offset point), text?, kind: 'lin'|'ali' }
  const p1 = { x: ent.x1, y: ent.y1 };
  const p2 = { x: ent.x2, y: ent.y2 };
  let dLine1 = p1, dLine2 = p2, textAngle = 0;
  if (ent.kind === 'lin') {
    // Linear: offset yönüne göre hizala (yatay/dikey en yakın)
    const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
    if (dx >= dy) {
      dLine1 = { x: p1.x, y: ent.oy }; dLine2 = { x: p2.x, y: ent.oy };
    } else {
      dLine1 = { x: ent.ox, y: p1.y }; dLine2 = { x: ent.ox, y: p2.y };
    }
  } else {
    // Aligned: offset dik yönde uzanır
    const vx = p2.x - p1.x, vy = p2.y - p1.y;
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy / len, ny = vx / len;  // dik
    // offset'ten origin çizgisine düşürülen dik vektörün uzunluğu:
    const d = ((ent.ox - p1.x) * nx + (ent.oy - p1.y) * ny);
    dLine1 = { x: p1.x + nx * d, y: p1.y + ny * d };
    dLine2 = { x: p2.x + nx * d, y: p2.y + ny * d };
    textAngle = Math.atan2(dLine2.y - dLine1.y, dLine2.x - dLine1.x) * 180 / Math.PI;
  }
  const a = acadW2S(p1.x, p1.y), b = acadW2S(p2.x, p2.y);
  const da = acadW2S(dLine1.x, dLine1.y), db = acadW2S(dLine2.x, dLine2.y);
  const mid = { x: (da.x + db.x) / 2, y: (da.y + db.y) / 2 };
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const text = ent.text || dist.toFixed(2);
  let out = '';
  // Yardımcı dik çizgiler
  out += `<line x1="${a.x}" y1="${a.y}" x2="${da.x}" y2="${da.y}" stroke="${color}" stroke-width="${sw * 0.7}"/>`;
  out += `<line x1="${b.x}" y1="${b.y}" x2="${db.x}" y2="${db.y}" stroke="${color}" stroke-width="${sw * 0.7}"/>`;
  // Ölçü çizgisi
  out += `<line x1="${da.x}" y1="${da.y}" x2="${db.x}" y2="${db.y}" stroke="${color}" stroke-width="${sw}"/>`;
  // Oklar
  const arrow = (px, py, qx, qy) => {
    const ang = Math.atan2(qy - py, qx - px);
    const ax = px + 8 * Math.cos(ang), ay = py + 8 * Math.sin(ang);
    const lx = px + 8 * Math.cos(ang + 0.3), ly = py + 8 * Math.sin(ang + 0.3);
    const rx = px + 8 * Math.cos(ang - 0.3), ry = py + 8 * Math.sin(ang - 0.3);
    return `<polygon points="${px},${py} ${lx},${ly} ${rx},${ry}" fill="${color}"/>`;
  };
  out += arrow(da.x, da.y, db.x, db.y);
  out += arrow(db.x, db.y, da.x, da.y);
  // Metin
  out += `<text x="${mid.x}" y="${mid.y - 4}" fill="${color}" font-size="11" font-family="DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" text-anchor="middle" transform="rotate(${textAngle} ${mid.x} ${mid.y})">${text}</text>`;
  return out;
}

function acadRenderSnapMarker(x, y, kind) {
  const col = '#ffb400';
  if (kind === 'endpoint') {
    return `<rect class="acad-snap-marker" x="${x-5}" y="${y-5}" width="10" height="10" fill="none" stroke="${col}" stroke-width="1.5"/>`;
  }
  if (kind === 'midpoint') {
    return `<polygon class="acad-snap-marker" points="${x},${y-6} ${x+6},${y+5} ${x-6},${y+5}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
  }
  if (kind === 'center') {
    return `<circle class="acad-snap-marker" cx="${x}" cy="${y}" r="5" fill="none" stroke="${col}" stroke-width="1.5"/>` +
           `<line x1="${x-7}" y1="${y}" x2="${x+7}" y2="${y}" stroke="${col}" stroke-width="0.8"/>` +
           `<line x1="${x}" y1="${y-7}" x2="${x}" y2="${y+7}" stroke="${col}" stroke-width="0.8"/>`;
  }
  if (kind === 'intersection') {
    return `<g class="acad-snap-marker"><line x1="${x-6}" y1="${y-6}" x2="${x+6}" y2="${y+6}" stroke="${col}" stroke-width="1.5"/>` +
           `<line x1="${x-6}" y1="${y+6}" x2="${x+6}" y2="${y-6}" stroke="${col}" stroke-width="1.5"/></g>`;
  }
  if (kind === 'grid') {
    return `<circle class="acad-snap-marker" cx="${x}" cy="${y}" r="3" fill="${col}"/>`;
  }
  return '';
}

// ─── Fit, zoom, pan ────────────────────────────────────────────────
function acadBoundsNew() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function acadBoundsAddPoint(b, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  b.minX = Math.min(b.minX, x);
  b.maxX = Math.max(b.maxX, x);
  b.minY = Math.min(b.minY, y);
  b.maxY = Math.max(b.maxY, y);
}

function acadBoundsAddRadius(b, cx, cy, r) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return;
  acadBoundsAddPoint(b, cx - Math.abs(r), cy - Math.abs(r));
  acadBoundsAddPoint(b, cx + Math.abs(r), cy + Math.abs(r));
}

function acadEntityBounds(entities = scanState.entities) {
  const e = entities || {};
  const b = acadBoundsNew();
  (e.lines || []).forEach(l => { acadBoundsAddPoint(b, l.x1, l.y1); acadBoundsAddPoint(b, l.x2, l.y2); });
  (e.circles || []).forEach(c => acadBoundsAddRadius(b, c.cx, c.cy, c.r));
  (e.arcs || []).forEach(a => acadBoundsAddRadius(b, a.cx, a.cy, a.r));
  (e.rectangles || []).forEach(r => { acadBoundsAddPoint(b, r.x1, r.y1); acadBoundsAddPoint(b, r.x2, r.y2); });
  (e.polylines || []).forEach(p => (p.points || []).forEach(pt => acadBoundsAddPoint(b, pt.x, pt.y)));
  (e.polygons || []).forEach(p => (p.points || []).forEach(pt => acadBoundsAddPoint(b, pt.x, pt.y)));
  (e.splines || []).forEach(s => (s.points || []).forEach(pt => acadBoundsAddPoint(b, pt.x, pt.y)));
  (e.ellipses || []).forEach(el => {
    const major = Math.hypot(el.mx || 0, el.my || 0);
    const r = major * Math.max(1, Math.abs(el.ratio || 0.5));
    acadBoundsAddRadius(b, el.cx, el.cy, r);
  });
  (e.points || []).forEach(p => acadBoundsAddPoint(b, p.x, p.y));
  (e.texts || []).forEach(t => {
    const h = Math.max(t.height || 10, 1);
    acadBoundsAddPoint(b, t.x, t.y);
    acadBoundsAddPoint(b, t.x + String(t.text || '').length * h * 0.65, t.y + h);
  });
  (e.dimensions || []).forEach(d => {
    acadBoundsAddPoint(b, d.x1, d.y1); acadBoundsAddPoint(b, d.x2, d.y2);
    acadBoundsAddPoint(b, d.ox, d.oy);
  });
  (e.leaders || []).forEach(l => {
    acadBoundsAddPoint(b, l.x1, l.y1); acadBoundsAddPoint(b, l.x2, l.y2); acadBoundsAddPoint(b, l.x3, l.y3);
  });
  (e.xlines || []).forEach(x => acadBoundsAddPoint(b, x.x, x.y));
  (e.rays || []).forEach(r => acadBoundsAddPoint(b, r.x, r.y));
  return Number.isFinite(b.minX) ? b : null;
}

function acadFit() {
  const area = document.getElementById('acadCanvasArea');
  if (area) {
    const r = area.getBoundingClientRect();
    acadState.width = Math.max(r.width || acadState.width || 0, 600);
    acadState.height = Math.max(r.height || acadState.height || 0, 420);
  }
  const W = acadState.width, H = acadState.height;
  const b = acadEntityBounds();
  if (!b) {
    acadState.zoom = 1;
    acadState.pan.x = W / 2;
    acadState.pan.y = H / 2;
    acadRender();
    return;
  }
  const ew = Math.max(b.maxX - b.minX, 1);
  const eh = Math.max(b.maxY - b.minY, 1);
  const margin = Math.max(36, Math.min(W, H) * 0.08);
  const usableW = Math.max(W - margin * 2, 160);
  const usableH = Math.max(H - margin * 2, 120);
  const zoom = Math.min(usableW / ew, usableH / eh);
  acadState.zoom = Math.max(Math.min(zoom, 12), 0.005);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  acadState.pan.x = W / 2 - cx * acadState.zoom;
  acadState.pan.y = H / 2 - cy * acadState.zoom;
  acadRender();
}
function acadZoom(factor) {
  const W = acadState.width / 2, H = acadState.height / 2;
  acadState.pan.x = W - (W - acadState.pan.x) * factor;
  acadState.pan.y = H - (H - acadState.pan.y) * factor;
  acadState.zoom *= factor;
  acadRender();
}
function acadWheel(ev) {
  ev.preventDefault();
  const factor = ev.deltaY < 0 ? 1.15 : 0.87;
  const sp = acadSvgPt(ev);
  acadState.pan.x = sp.x - (sp.x - acadState.pan.x) * factor;
  acadState.pan.y = (acadState.height - sp.y) - ((acadState.height - sp.y) - acadState.pan.y) * factor;
  acadState.zoom *= factor;
  acadRender();
}

// ─── Snap tespit ────────────────────────────────────────────────────
function acadFindSnap(sx, sy) {
  const tol = acadState.snapTol;
  const best = { dist: Infinity, pt: null, kind: null };
  if (!acadState.osnap) return null;

  const consider = (wx, wy, kind) => {
    const s = acadW2S(wx, wy);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d < tol && d < best.dist) { best.dist = d; best.pt = { x: wx, y: wy, kind }; }
  };

  const e = scanState.entities; if (!e) return null;
  (e.lines || []).forEach(l => {
    consider(l.x1, l.y1, 'endpoint');
    consider(l.x2, l.y2, 'endpoint');
    consider((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2, 'midpoint');
  });
  (e.circles || []).forEach(c => {
    consider(c.cx, c.cy, 'center');
    // 4 quadrant nokta
    consider(c.cx + c.r, c.cy, 'endpoint');
    consider(c.cx - c.r, c.cy, 'endpoint');
    consider(c.cx, c.cy + c.r, 'endpoint');
    consider(c.cx, c.cy - c.r, 'endpoint');
  });
  (e.arcs || []).forEach(a => {
    consider(a.cx, a.cy, 'center');
    const rad = v => v * Math.PI / 180;
    consider(a.cx + a.r * Math.cos(rad(a.start_angle || 0)), a.cy + a.r * Math.sin(rad(a.start_angle || 0)), 'endpoint');
    consider(a.cx + a.r * Math.cos(rad(a.end_angle || 0)), a.cy + a.r * Math.sin(rad(a.end_angle || 0)), 'endpoint');
  });
  (e.rectangles || []).forEach(r => {
    consider(r.x1, r.y1, 'endpoint'); consider(r.x2, r.y1, 'endpoint');
    consider(r.x2, r.y2, 'endpoint'); consider(r.x1, r.y2, 'endpoint');
    consider((r.x1 + r.x2) / 2, r.y1, 'midpoint'); consider((r.x1 + r.x2) / 2, r.y2, 'midpoint');
    consider(r.x1, (r.y1 + r.y2) / 2, 'midpoint'); consider(r.x2, (r.y1 + r.y2) / 2, 'midpoint');
  });
  (e.polylines || []).forEach(p => {
    (p.points || []).forEach(pt => consider(pt.x, pt.y, 'endpoint'));
    const pts = p.points || [];
    for (let i = 0; i < pts.length - 1; i++) {
      consider((pts[i].x + pts[i+1].x) / 2, (pts[i].y + pts[i+1].y) / 2, 'midpoint');
    }
  });
  (e.polygons || []).forEach(p => {
    (p.points || []).forEach(pt => consider(pt.x, pt.y, 'endpoint'));
  });
  (e.splines || []).forEach(s => {
    const pts = s.points || [];
    if (pts.length >= 2) {
      consider(pts[0].x, pts[0].y, 'endpoint');
      consider(pts[pts.length - 1].x, pts[pts.length - 1].y, 'endpoint');
    }
  });
  (e.ellipses || []).forEach(el => {
    consider(el.cx, el.cy, 'center');
  });
  (e.points || []).forEach(p => consider(p.x, p.y, 'endpoint'));
  (e.texts || []).forEach(t => consider(t.x, t.y, 'endpoint'));
  (e.leaders || []).forEach(l => {
    consider(l.x1, l.y1, 'endpoint'); consider(l.x2, l.y2, 'endpoint'); consider(l.x3, l.y3, 'endpoint');
  });

  return best.pt;
}

// ─── Grid snap ──────────────────────────────────────────────────────
function acadApplyGridSnap(w) {
  if (!acadState.gridSnap) return w;
  const g = acadState.gridSize;
  return { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g };
}

// ─── Ortho ─────────────────────────────────────────────────────────
function acadApplyOrtho(from, to) {
  if (!acadState.ortho || !from) return to;
  const dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
  return dx > dy ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

function acadPendingBasePoint(p) {
  if (!p || !Array.isArray(p.points) || !p.points.length) return null;
  return p.points[p.points.length - 1];
}

function acadNumberPattern() {
  return '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
}

function acadParseCommandPoint(raw, p) {
  const text = String(raw || '').trim();
  const n = acadNumberPattern();
  const base = acadPendingBasePoint(p) || { x: 0, y: 0 };
  let m = text.match(new RegExp(`^(${n})\\s*,\\s*(${n})$`));
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  m = text.match(new RegExp(`^@\\s*(${n})\\s*,\\s*(${n})$`));
  if (m) return { x: base.x + parseFloat(m[1]), y: base.y + parseFloat(m[2]) };
  m = text.match(new RegExp(`^@?\\s*(${n})\\s*<\\s*(${n})$`));
  if (m) {
    const dist = parseFloat(m[1]);
    const angle = parseFloat(m[2]) * Math.PI / 180;
    return { x: base.x + dist * Math.cos(angle), y: base.y + dist * Math.sin(angle) };
  }
  return null;
}

function acadApplyNumericArgument(raw, p) {
  const value = parseFloat(raw);
  if (!p || isNaN(value)) return false;
  if (p.type === 'circle' && p.points.length === 1 && value > 0) {
    const c = p.points[0];
    acadHandleToolClick({ x: c.x + value, y: c.y }, { shiftKey: false, ctrlKey: false, button: 0 });
    return true;
  }
  if ((p.type === 'line' || p.type === 'polyline') && p.points.length >= 1 && value > 0) {
    const base = acadPendingBasePoint(p);
    let dx = acadState.mouseWorld.x - base.x;
    let dy = acadState.mouseWorld.y - base.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) { dx = 1; dy = 0; }
    else { dx /= len; dy /= len; }
    acadHandleToolClick({ x: base.x + dx * value, y: base.y + dy * value }, { shiftKey: false, ctrlKey: false, button: 0 });
    return true;
  }
  if (p.type === 'polygon' && p.step === 1 && p.points.length === 1 && value > 0) {
    const c = p.points[0];
    acadHandleToolClick({ x: c.x + value, y: c.y }, { shiftKey: false, ctrlKey: false, button: 0 });
    return true;
  }
  return false;
}

// Efektif nokta: snap > grid > ortho > raw
function acadResolvePoint(ev, fromPoint = null) {
  const sp = acadSvgPt(ev);
  const snap = acadFindSnap(sp.x, sp.y);
  if (snap) { acadState.hoverSnap = snap; return { x: snap.x, y: snap.y }; }
  acadState.hoverSnap = null;
  let w = acadS2W(sp.x, sp.y);
  if (fromPoint) w = acadApplyOrtho(fromPoint, w);
  w = acadApplyGridSnap(w);
  if (acadState.gridSnap) acadState.hoverSnap = { x: w.x, y: w.y, kind: 'grid' };
  return w;
}

// ─── Mouse event'leri ──────────────────────────────────────────────
function acadMouseMove(ev) {
  const sp = acadSvgPt(ev);
  acadState.mouseScreen = sp;
  const from = acadState.pending?.points?.[acadState.pending.points.length - 1] || null;
  const w = acadResolvePoint(ev, from);
  acadState.mouseWorld = w;
  document.getElementById('acadCoordX').textContent = w.x.toFixed(2);
  document.getElementById('acadCoordY').textContent = w.y.toFixed(2);
  // Pan with middle mouse / Shift+Left
  if (acadState.panning) {
    const dx = sp.x - acadState.panStart.x, dy = sp.y - acadState.panStart.y;
    acadState.pan.x += dx;
    acadState.pan.y -= dy;
    acadState.panStart = sp;
  }
  acadRender();
}

function acadMouseDown(ev) {
  // Orta tık veya shift+sol tık → pan
  if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
    ev.preventDefault();
    acadState.panning = true;
    acadState.panStart = acadSvgPt(ev);
    return;
  }
  if (ev.button === 2) {
    // Sağ tık → cancel current tool
    acadCancel();
    return;
  }
  if (ev.button !== 0) return;

  const from = acadState.pending?.points?.[acadState.pending.points.length - 1] || null;
  const pt = acadResolvePoint(ev, from);
  acadHandleToolClick(pt, ev);
}

function acadMouseUp(ev) {
  if (acadState.panning) { acadState.panning = false; return; }
}

// ─── Cancel ─────────────────────────────────────────────────────────
function acadCancel() {
  if (acadState.pending) {
    acadLog('İptal edildi.', 'cmd-err');
    acadState.pending = null;
  }
  acadState.selection = [];
  acadSetPrompt('Komut:');
  acadState.tool = 'select';
  acadHighlightToolBtn('select');
  acadRender();
}

// ─── Tool aktivasyonu ──────────────────────────────────────────────
function acadHighlightToolBtn(tool) {
  document.querySelectorAll('.acad-tool[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
}

function acadSetTool(tool) {
  // Tool değişince pending akışı iptal
  if (acadState.pending && acadState.tool !== tool) {
    acadState.pending = null;
  }
  acadState.tool = tool;
  if (tool && tool !== 'select') acadState.lastTool = tool;
  acadHighlightToolBtn(tool);

  // Tool init akışı
  switch (tool) {
    case 'line':
      acadState.pending = { type: 'line', step: 0, points: [] };
      acadSetPrompt('LINE — Birinci nokta:');
      acadLog('LINE: Başlangıç noktasını tıklayın. Enter=bitir, Sağ tık=iptal.', 'cmd-ok');
      break;
    case 'circle':
      acadState.pending = { type: 'circle', step: 0, points: [] };
      acadSetPrompt('CIRCLE — Merkez noktası:');
      acadLog('CIRCLE: Merkez noktasını tıklayın.', 'cmd-ok');
      break;
    case 'arc':
      acadState.pending = { type: 'arc', step: 0, points: [] };
      acadSetPrompt('ARC — Birinci nokta:');
      acadLog('ARC: 3 nokta ile yay (1:başlangıç, 2:orta, 3:bitiş).', 'cmd-ok');
      break;
    case 'rect':
      acadState.pending = { type: 'rect', step: 0, points: [] };
      acadSetPrompt('RECTANGLE — Birinci köşe:');
      acadLog('RECTANGLE: İki köşe tıklayın.', 'cmd-ok');
      break;
    case 'polyline':
      acadState.pending = { type: 'polyline', step: 0, points: [], closed: false };
      acadSetPrompt('POLYLINE — Birinci nokta:');
      acadLog('POLYLINE: Nokta ekle. Enter=bitir, C=kapat, Sağ tık=iptal.', 'cmd-ok');
      break;
    case 'polygon':
      acadState.pending = { type: 'polygon', step: 0, points: [], sides: 6 };
      acadSetPrompt('POLYGON — Kenar sayısı (örn. 6) Enter:');
      acadLog('POLYGON: Kenar sayısını komut satırına yaz, sonra merkez ve yarıçap tıkla.', 'cmd-ok');
      break;
    case 'dim-lin':
      acadState.pending = { type: 'dim-lin', step: 0, points: [] };
      acadSetPrompt('DIM LINEAR — Birinci dayanak noktası:');
      acadLog('DIM LINEAR: 2 nokta + ölçü çizgisi offset noktası.', 'cmd-ok');
      break;
    case 'dim-ali':
      acadState.pending = { type: 'dim-ali', step: 0, points: [] };
      acadSetPrompt('DIM ALIGNED — Birinci dayanak noktası:');
      acadLog('DIM ALIGNED: 2 nokta + ölçü çizgisi offset noktası.', 'cmd-ok');
      break;
    case 'move':
      if (!acadState.selection.length) {
        acadLog('MOVE: Önce taşınacak nesneleri seçin (SELECT aracı).', 'cmd-err');
        acadState.tool = 'select'; acadHighlightToolBtn('select'); return;
      }
      acadState.pending = { type: 'move', step: 0, points: [], sel: [...acadState.selection] };
      acadSetPrompt('MOVE — Referans noktası:');
      acadLog('MOVE: Referans noktasını tıkla, sonra hedefi tıkla.', 'cmd-ok');
      break;
    case 'copy':
      if (!acadState.selection.length) {
        acadLog('COPY: Önce kopyalanacak nesneleri seçin.', 'cmd-err');
        acadState.tool = 'select'; acadHighlightToolBtn('select'); return;
      }
      acadState.pending = { type: 'copy', step: 0, points: [], sel: [...acadState.selection] };
      acadSetPrompt('COPY — Referans noktası:');
      acadLog('COPY: Referans + hedef. Enter=bitir, birden fazla kopya için tekrar tıkla.', 'cmd-ok');
      break;
    case 'rotate':
      if (!acadState.selection.length) {
        acadLog('ROTATE: Önce nesne seçin.', 'cmd-err');
        acadState.tool = 'select'; acadHighlightToolBtn('select'); return;
      }
      acadState.pending = { type: 'rotate', step: 0, points: [], sel: [...acadState.selection] };
      acadSetPrompt('ROTATE — Merkez noktası:');
      acadLog('ROTATE: Merkez tıkla, sonra hedef açı (tıkla veya derece yaz).', 'cmd-ok');
      break;
    case 'erase':
      if (acadState.selection.length) {
        acadEraseSelection();
        acadState.tool = 'select'; acadHighlightToolBtn('select');
        return;
      }
      acadSetPrompt('ERASE — Silinecek nesneye tıklayın:');
      acadLog('ERASE: Üstüne tıklanan nesne silinir.', 'cmd-ok');
      break;
    case 'trim':
      acadSetPrompt('TRIM — Kesilecek çizgiye tıklayın (basit mod: tıklanan tarafı keser):');
      acadLog('TRIM: Tıklanan uç, en yakın kesişime kadar budanır.', 'cmd-ok');
      break;
    case 'extend':
      acadSetPrompt('EXTEND — Uzatılacak çizgiye tıklayın:');
      acadLog('EXTEND: Çizginin tıklanan ucu, en yakın kesişime kadar uzar.', 'cmd-ok');
      break;
    case 'offset':
      acadState.pending = { type: 'offset', step: 0, points: [], dist: 10 };
      acadSetPrompt('OFFSET — Mesafe (örn: 10) Enter:');
      acadLog('OFFSET: Mesafe yaz, sonra nesneye ve hangi tarafa tıkla.', 'cmd-ok');
      break;
    // ── Yeni çizim araçları ──
    case 'text':
      acadState.pending = { type: 'text', step: 0, points: [] };
      acadSetPrompt('TEXT — Yerleştirme noktası:');
      acadLog('TEXT: Nokta tıklayın, sonra metin ve yüksekliği girin.', 'cmd-ok');
      break;
    case 'point':
      acadState.pending = { type: 'point', step: 0, points: [] };
      acadSetPrompt('POINT — Nokta (sürekli):');
      acadLog('POINT: Tıkladığınız yere nokta bırakır. ESC ile çıkın.', 'cmd-ok');
      break;
    case 'ellipse':
      acadState.pending = { type: 'ellipse', step: 0, points: [] };
      acadSetPrompt('ELLIPSE — Merkez noktası:');
      acadLog('ELLIPSE: Merkez, 1. eksen ucu, 2. yarıçap noktası.', 'cmd-ok');
      break;
    case 'xline':
      acadState.pending = { type: 'xline', step: 0, points: [] };
      acadSetPrompt('XLINE — Geçiş noktası:');
      acadLog('XLINE: Sonsuz referans çizgisi. 2 nokta tıkla.', 'cmd-ok');
      break;
    case 'ray':
      acadState.pending = { type: 'ray', step: 0, points: [] };
      acadSetPrompt('RAY — Başlangıç noktası:');
      acadLog('RAY: Yarı-sonsuz çizgi. 2 nokta tıkla.', 'cmd-ok');
      break;
    case 'leader':
      acadState.pending = { type: 'leader', step: 0, points: [] };
      acadSetPrompt('LEADER — Ok ucu noktası:');
      acadLog('LEADER: Ok ucu, kırılma, metin noktası → 3 tıklama + metin.', 'cmd-ok');
      break;
    // ── Yeni düzenleme araçları ──
    case 'fillet':
      acadCmdFilletStart();
      break;
    case 'chamfer':
      acadCmdChamferStart();
      break;
    case 'mirror':
      acadCmdMirrorStart();
      break;
    case 'scale':
      acadCmdScaleStart();
      break;
    case 'break':
      acadCmdBreakStart();
      break;
    case 'select':
    default:
      acadSetPrompt('Komut:');
      break;
  }
  acadRender();
}

// ─── Tool click dispatcher ─────────────────────────────────────────
function acadHandleToolClick(pt, ev) {
  const t = acadState.tool;
  const p = acadState.pending;

  // Yeni komut tiplerini önce dene (fillet/chamfer/mirror/scale/break/dist/id/text/point/ellipse/xline/ray/leader)
  if (typeof acadHandleExtClick === 'function' && acadHandleExtClick(pt, ev)) return;

  // SELECT aracı: tıklanana en yakın entity'yi seç
  if (t === 'select') {
    const hit = acadHitTest(pt, ev);
    if (!ev.ctrlKey && !ev.shiftKey) acadState.selection = [];
    if (hit) {
      const already = acadState.selection.findIndex(s => s.type === hit.type && s.index === hit.index);
      if (already >= 0) acadState.selection.splice(already, 1);
      else acadState.selection.push(hit);
    }
    acadUpdateSelectionInfo();
    acadRender();
    return;
  }

  // ERASE
  if (t === 'erase' && !p) {
    const hit = acadHitTest(pt, ev);
    if (hit) {
      acadSnapshot();
      const key = hit.type + 's';
      if (scanState.entities[key]) scanState.entities[key].splice(hit.index, 1);
      acadLog(`${hit.type.toUpperCase()} silindi.`, 'cmd-ok');
      acadState.selection = [];
      acadRender();
    }
    return;
  }

  // TRIM
  if (t === 'trim') {
    acadDoTrim(pt);
    return;
  }
  if (t === 'extend') {
    acadDoExtend(pt);
    return;
  }

  if (!p) return;

  // LINE
  if (p.type === 'line') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('LINE — İkinci nokta:');
      p.preview = () => {
        const a = acadW2S(p.points[0].x, p.points[0].y);
        const b = acadW2S(acadState.mouseWorld.x, acadState.mouseWorld.y);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3"/>`;
      };
    } else {
      acadSnapshot();
      scanState.entities.lines.push({
        type: 'LINE', x1: p.points[0].x, y1: p.points[0].y,
        x2: p.points[1].x, y2: p.points[1].y, layer: acadState.currentLayer,
      });
      acadLog(`LINE: (${p.points[0].x.toFixed(2)}, ${p.points[0].y.toFixed(2)}) → (${p.points[1].x.toFixed(2)}, ${p.points[1].y.toFixed(2)}) çizildi.`, 'cmd-ok');
      // Sürekli mod: bir sonraki çizgi için hazırla
      acadState.pending = { type: 'line', step: 1, points: [p.points[1]] };
      acadState.pending.preview = () => {
        const a = acadW2S(acadState.pending.points[0].x, acadState.pending.points[0].y);
        const b = acadW2S(acadState.mouseWorld.x, acadState.mouseWorld.y);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3"/>`;
      };
      acadSetPrompt('LINE — Sonraki nokta (Enter=bitir):');
    }
    acadRender();
    return;
  }

  // CIRCLE (merkez + yarıçap noktası)
  if (p.type === 'circle') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('CIRCLE — Yarıçap (nokta veya sayı):');
      p.preview = () => {
        const c = acadW2S(p.points[0].x, p.points[0].y);
        const r = Math.hypot(acadState.mouseWorld.x - p.points[0].x, acadState.mouseWorld.y - p.points[0].y);
        return `<circle cx="${c.x}" cy="${c.y}" r="${r * acadState.zoom}" fill="none" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3"/>`;
      };
    } else {
      const r = Math.hypot(p.points[1].x - p.points[0].x, p.points[1].y - p.points[0].y);
      if (r > 0.0001) {
        acadSnapshot();
        scanState.entities.circles.push({
          type: 'CIRCLE', cx: p.points[0].x, cy: p.points[0].y, r, layer: acadState.currentLayer,
        });
        acadLog(`CIRCLE: merkez (${p.points[0].x.toFixed(2)}, ${p.points[0].y.toFixed(2)}), r=${r.toFixed(2)}`, 'cmd-ok');
      }
      acadState.pending = null;
      acadSetTool('circle'); // sürekli
    }
    acadRender();
    return;
  }

  // ARC (3 nokta)
  if (p.type === 'arc') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('ARC — Orta nokta:');
      p.preview = () => {
        const a = acadW2S(p.points[0].x, p.points[0].y);
        const b = acadW2S(acadState.mouseWorld.x, acadState.mouseWorld.y);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffb400" stroke-dasharray="5 3"/>`;
      };
    } else if (p.points.length === 2) {
      acadSetPrompt('ARC — Bitiş noktası:');
      p.preview = () => {
        const arc = acadArc3pt(p.points[0], p.points[1], acadState.mouseWorld);
        if (!arc) return '';
        return acadRenderEntity(
          { cx: arc.cx, cy: arc.cy, r: arc.r, start_angle: arc.start * 180 / Math.PI, end_angle: arc.end * 180 / Math.PI },
          'arc', -1, '#ffb400', 1);
      };
    } else {
      const arc = acadArc3pt(p.points[0], p.points[1], p.points[2]);
      if (arc) {
        acadSnapshot();
        scanState.entities.arcs.push({
          type: 'ARC', cx: arc.cx, cy: arc.cy, r: arc.r,
          start_angle: arc.start * 180 / Math.PI, end_angle: arc.end * 180 / Math.PI,
          layer: acadState.currentLayer,
        });
        acadLog(`ARC: merkez (${arc.cx.toFixed(2)},${arc.cy.toFixed(2)}), r=${arc.r.toFixed(2)}`, 'cmd-ok');
      }
      acadState.pending = null;
      acadSetTool('arc');
    }
    acadRender();
    return;
  }

  // RECT
  if (p.type === 'rect') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('RECTANGLE — Karşı köşe:');
      p.preview = () => {
        const a = acadW2S(p.points[0].x, p.points[0].y);
        const b = acadW2S(acadState.mouseWorld.x, acadState.mouseWorld.y);
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3"/>`;
      };
    } else {
      if (Math.abs(p.points[1].x - p.points[0].x) > 0.0001 && Math.abs(p.points[1].y - p.points[0].y) > 0.0001) {
        acadSnapshot();
        scanState.entities.rectangles.push({
          type: 'RECT', x1: p.points[0].x, y1: p.points[0].y,
          x2: p.points[1].x, y2: p.points[1].y, layer: acadState.currentLayer,
        });
        acadLog(`RECT: (${p.points[0].x.toFixed(1)},${p.points[0].y.toFixed(1)}) - (${p.points[1].x.toFixed(1)},${p.points[1].y.toFixed(1)})`, 'cmd-ok');
      }
      acadState.pending = null;
      acadSetTool('rect');
    }
    acadRender();
    return;
  }

  // POLYLINE
  if (p.type === 'polyline') {
    p.points.push(pt);
    acadSetPrompt(`POLYLINE — ${p.points.length+1}. nokta (Enter=bitir, C=kapat):`);
    p.preview = () => {
      const pts = p.points.map(pp => acadW2S(pp.x, pp.y));
      pts.push(acadW2S(acadState.mouseWorld.x, acadState.mouseWorld.y));
      const d = 'M ' + pts.map(pp => `${pp.x} ${pp.y}`).join(' L ');
      return `<path d="${d}" fill="none" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3"/>`;
    };
    acadRender();
    return;
  }

  // POLYGON — merkez ve yarıçap
  if (p.type === 'polygon') {
    if (p.step === 0) {
      // Henüz kenar sayısı yazılmamış, önce command line'dan sayı bekleniyor
      acadLog('POLYGON: önce komut satırına kenar sayısı (örn 6) yazıp Enter basın.', 'cmd-err');
      return;
    }
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('POLYGON — Köşe noktası (yarıçap):');
      p.preview = () => acadPolygonSvg(p.points[0], acadState.mouseWorld, p.sides, '#ffb400', '5 3');
    } else {
      const pts = acadPolygonPoints(p.points[0], p.points[1], p.sides);
      if (pts.length) {
        acadSnapshot();
        scanState.entities.polygons.push({
          type: 'POLYGON', points: pts, layer: acadState.currentLayer, sides: p.sides,
        });
        acadLog(`POLYGON: ${p.sides} kenar çizildi.`, 'cmd-ok');
      }
      acadState.pending = null;
      acadSetPrompt('Komut:');
      acadState.tool = 'select';
      acadHighlightToolBtn('select');
    }
    acadRender();
    return;
  }

  // DIMENSION — linear / aligned
  if (p.type === 'dim-lin' || p.type === 'dim-ali') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('DIM — İkinci dayanak noktası:');
      p.preview = () => {
        const a = acadW2S(p.points[0].x, p.points[0].y);
        const b = acadW2S(acadState.mouseWorld.x, acadState.mouseWorld.y);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffb400" stroke-dasharray="5 3"/>`;
      };
    } else if (p.points.length === 2) {
      acadSetPrompt('DIM — Ölçü çizgisi yerleşim noktası:');
      p.preview = () => {
        const kind = p.type === 'dim-lin' ? 'lin' : 'ali';
        return acadRenderDimension({
          x1: p.points[0].x, y1: p.points[0].y, x2: p.points[1].x, y2: p.points[1].y,
          ox: acadState.mouseWorld.x, oy: acadState.mouseWorld.y, kind,
        }, '#ffb400', 1);
      };
    } else {
      acadSnapshot();
      const kind = p.type === 'dim-lin' ? 'lin' : 'ali';
      scanState.entities.dimensions.push({
        type: 'DIM', x1: p.points[0].x, y1: p.points[0].y,
        x2: p.points[1].x, y2: p.points[1].y,
        ox: p.points[2].x, oy: p.points[2].y, kind,
        layer: acadState.currentLayer,
      });
      acadLog(`${kind === 'lin' ? 'LINEAR' : 'ALIGNED'} ölçü eklendi.`, 'cmd-ok');
      acadState.pending = null;
      acadSetPrompt('Komut:');
      acadState.tool = 'select';
      acadHighlightToolBtn('select');
    }
    acadRender();
    return;
  }

  // MOVE / COPY
  if (p.type === 'move' || p.type === 'copy') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt(p.type === 'move' ? 'MOVE — Hedef nokta:' : 'COPY — Hedef nokta:');
      p.preview = () => {
        const dx = acadState.mouseWorld.x - p.points[0].x;
        const dy = acadState.mouseWorld.y - p.points[0].y;
        return acadPreviewTransform(p.sel, e => acadShiftEntity(e, dx, dy));
      };
    } else {
      const dx = p.points[1].x - p.points[0].x;
      const dy = p.points[1].y - p.points[0].y;
      acadSnapshot();
      if (p.type === 'move') {
        p.sel.forEach(s => {
          const arr = scanState.entities[s.type + 's'];
          if (arr && arr[s.index]) acadShiftEntityInPlace(arr[s.index], dx, dy);
        });
        acadLog(`MOVE: ${p.sel.length} nesne taşındı.`, 'cmd-ok');
        acadState.pending = null;
        acadState.selection = [];
        acadSetPrompt('Komut:');
        acadState.tool = 'select';
        acadHighlightToolBtn('select');
      } else {
        // COPY: yeni entity oluştur
        p.sel.forEach(s => {
          const arr = scanState.entities[s.type + 's'];
          if (arr && arr[s.index]) {
            const cp = JSON.parse(JSON.stringify(arr[s.index]));
            acadShiftEntityInPlace(cp, dx, dy);
            arr.push(cp);
          }
        });
        acadLog(`COPY: ${p.sel.length} nesne kopyalandı. (Enter=bitir, tekrar hedef tıkla)`, 'cmd-ok');
        // Devam et: p.points[1] referans olarak kal, yeni hedef beklensin
        p.points = [p.points[0]];
      }
    }
    acadRender();
    return;
  }

  // ROTATE
  if (p.type === 'rotate') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('ROTATE — Referans açı noktası:');
      p.preview = () => {
        const ang = Math.atan2(acadState.mouseWorld.y - p.points[0].y, acadState.mouseWorld.x - p.points[0].x);
        return acadPreviewTransform(p.sel, e => acadRotateEntity(e, p.points[0].x, p.points[0].y, ang));
      };
    } else {
      const ang = Math.atan2(p.points[1].y - p.points[0].y, p.points[1].x - p.points[0].x);
      acadSnapshot();
      p.sel.forEach(s => {
        const arr = scanState.entities[s.type + 's'];
        if (arr && arr[s.index]) {
          const rot = acadRotateEntity(arr[s.index], p.points[0].x, p.points[0].y, ang);
          Object.assign(arr[s.index], rot);
        }
      });
      acadLog(`ROTATE: ${p.sel.length} nesne ${(ang*180/Math.PI).toFixed(1)}° döndürüldü.`, 'cmd-ok');
      acadState.pending = null;
      acadState.selection = [];
      acadSetPrompt('Komut:');
      acadState.tool = 'select';
      acadHighlightToolBtn('select');
    }
    acadRender();
    return;
  }

  // OFFSET
  if (p.type === 'offset') {
    if (p.step === 0) {
      acadLog('OFFSET: önce komut satırına mesafe yazın.', 'cmd-err');
      return;
    }
    if (!p.picked) {
      const hit = acadHitTest(pt, ev);
      if (!hit) { acadLog('Offset için bir nesne seçin.', 'cmd-err'); return; }
      p.picked = hit;
      acadSetPrompt('OFFSET — Hangi tarafa? (tıkla):');
    } else {
      const arr = scanState.entities[p.picked.type + 's'];
      const src = arr[p.picked.index];
      const off = acadOffsetEntity(src, p.picked.type, p.dist, pt);
      if (off) {
        acadSnapshot();
        arr.push(off);
        acadLog(`OFFSET: kopya ${p.dist} birim mesafede oluşturuldu.`, 'cmd-ok');
      } else {
        acadLog('OFFSET: Bu entity tipi desteklenmiyor.', 'cmd-err');
      }
      acadState.pending = null;
      acadSetTool('offset');
    }
    acadRender();
    return;
  }
}

// ─── Hit testing (fare tıklaması → entity seç) ─────────────────────
function acadHitTest(pt, ev) {
  const tol = 6 / acadState.zoom;
  const e = scanState.entities;
  if (!e) return null;
  const distPt = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const distSeg = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return distPt(p, a);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return distPt(p, b);
    const t = c1 / c2;
    return distPt(p, { x: a.x + t * vx, y: a.y + t * vy });
  };

  const visible = (layer) => {
    const L = acadState.layers.find(l => l.name === (layer || '0'));
    return !L || (L.visible && !L.locked);
  };

  let best = null;
  const consider = (d, ref) => { if (d < tol && (!best || d < best.d)) best = { d, ...ref }; };

  (e.lines || []).forEach((l, i) => {
    if (!visible(l.layer)) return;
    consider(distSeg(pt, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }), { type: 'line', index: i });
  });
  (e.circles || []).forEach((c, i) => {
    if (!visible(c.layer)) return;
    const d = Math.abs(Math.hypot(pt.x - c.cx, pt.y - c.cy) - c.r);
    consider(d, { type: 'circle', index: i });
  });
  (e.arcs || []).forEach((a, i) => {
    if (!visible(a.layer)) return;
    const d = Math.abs(Math.hypot(pt.x - a.cx, pt.y - a.cy) - a.r);
    consider(d, { type: 'arc', index: i });
  });
  (e.rectangles || []).forEach((r, i) => {
    if (!visible(r.layer)) return;
    const pts = [{x:r.x1,y:r.y1},{x:r.x2,y:r.y1},{x:r.x2,y:r.y2},{x:r.x1,y:r.y2}];
    for (let k = 0; k < 4; k++) {
      const d = distSeg(pt, pts[k], pts[(k+1)%4]);
      consider(d, { type: 'rectangle', index: i });
    }
  });
  (e.polylines || []).forEach((p, i) => {
    if (!visible(p.layer)) return;
    const pts = p.points || [];
    for (let k = 0; k < pts.length - 1; k++) {
      consider(distSeg(pt, pts[k], pts[k+1]), { type: 'polyline', index: i });
    }
  });
  (e.polygons || []).forEach((p, i) => {
    if (!visible(p.layer)) return;
    const pts = p.points || [];
    for (let k = 0; k < pts.length; k++) {
      consider(distSeg(pt, pts[k], pts[(k+1)%pts.length]), { type: 'polygon', index: i });
    }
  });
  (e.dimensions || []).forEach((d, i) => {
    if (!visible(d.layer)) return;
    consider(distSeg(pt, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }), { type: 'dimension', index: i });
  });
  (e.splines || []).forEach((s, i) => {
    if (!visible(s.layer)) return;
    const samples = acadSplineSamples(s, 20);
    for (let k = 0; k < samples.length - 1; k++) {
      consider(distSeg(pt, samples[k], samples[k+1]), { type: 'spline', index: i });
    }
  });
  (e.ellipses || []).forEach((el, i) => {
    if (!visible(el.layer)) return;
    // Elips örnekle
    const samples = acadEllipseSamples(el, 36);
    for (let k = 0; k < samples.length - 1; k++) {
      consider(distSeg(pt, samples[k], samples[k+1]), { type: 'ellipse', index: i });
    }
  });
  (e.points || []).forEach((p, i) => {
    if (!visible(p.layer)) return;
    consider(distPt(pt, p), { type: 'point', index: i });
  });
  (e.texts || []).forEach((t, i) => {
    if (!visible(t.layer)) return;
    consider(distPt(pt, t), { type: 'text', index: i });
  });
  (e.xlines || []).forEach((x, i) => {
    if (!visible(x.layer)) return;
    const rad = (x.angle || 0) * Math.PI / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    // Sonsuz çizgiye dik mesafe
    const d = Math.abs(uy * (pt.x - x.x) - ux * (pt.y - x.y));
    consider(d, { type: 'xline', index: i });
  });
  (e.rays || []).forEach((r, i) => {
    if (!visible(r.layer)) return;
    const rad = (r.angle || 0) * Math.PI / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    const t = (pt.x - r.x) * ux + (pt.y - r.y) * uy;
    if (t < 0) { consider(distPt(pt, r), { type: 'ray', index: i }); }
    else {
      const fx = r.x + ux * t, fy = r.y + uy * t;
      consider(Math.hypot(pt.x - fx, pt.y - fy), { type: 'ray', index: i });
    }
  });
  (e.leaders || []).forEach((l, i) => {
    if (!visible(l.layer)) return;
    const d1 = distSeg(pt, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
    const d2 = distSeg(pt, { x: l.x2, y: l.y2 }, { x: l.x3, y: l.y3 });
    consider(Math.min(d1, d2), { type: 'leader', index: i });
  });
  return best;
}

// Elipsi N segmente örnekle (hit test için)
function acadEllipseSamples(el, n) {
  const out = [];
  const R = Math.hypot(el.mx, el.my);
  const ratio = el.ratio || 0.5;
  const ang0 = Math.atan2(el.my, el.mx);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const x0 = R * Math.cos(t), y0 = R * ratio * Math.sin(t);
    // Eksenleri ang0'ya göre döndür
    const rx = x0 * Math.cos(ang0) - y0 * Math.sin(ang0);
    const ry = x0 * Math.sin(ang0) + y0 * Math.cos(ang0);
    out.push({ x: el.cx + rx, y: el.cy + ry });
  }
  return out;
}

// Bezier'ı düz çizgi parçalarına örnekle
function acadSplineSamples(s, n) {
  const p = s.points || [];
  const out = [];
  if (p.length === 4) {
    // Cubic
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u*u*u*p[0].x + 3*u*u*t*p[1].x + 3*u*t*t*p[2].x + t*t*t*p[3].x;
      const y = u*u*u*p[0].y + 3*u*u*t*p[1].y + 3*u*t*t*p[2].y + t*t*t*p[3].y;
      out.push({ x, y });
    }
  } else if (p.length === 3) {
    // Quadratic
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u*u*p[0].x + 2*u*t*p[1].x + t*t*p[2].x;
      const y = u*u*p[0].y + 2*u*t*p[1].y + t*t*p[2].y;
      out.push({ x, y });
    }
  } else {
    p.forEach(pt => out.push({ x: pt.x, y: pt.y }));
  }
  return out;
}

function acadPropRows(rows) {
  return rows.map(([label, value]) =>
    `<div class="acad-prop-row"><span>${escHtml(label)}</span><b title="${escHtml(value)}">${escHtml(value)}</b></div>`
  ).join('');
}

function acadTypeLabel(type) {
  const labels = {
    lines: 'Lines', circles: 'Circles', arcs: 'Arcs', texts: 'Text',
    polylines: 'Polylines', rectangles: 'Rectangles', polygons: 'Polygons',
    dimensions: 'Dimensions', splines: 'Splines', ellipses: 'Ellipses',
    points: 'Points', xlines: 'XLines', rays: 'Rays', leaders: 'Leaders',
  };
  return labels[type] || type;
}

function acadTypeRows(entities = scanState.entities) {
  const e = entities || {};
  return CAD_ENTITY_KEYS
    .map(key => ({ key, count: (e[key] || []).length }))
    .filter(item => item.count > 0);
}

function acadFirstSelection() {
  if (!acadState.selection.length || !scanState.entities) return null;
  const sel = acadState.selection[0];
  const arr = scanState.entities[sel.type + 's'];
  if (!arr || !arr[sel.index]) return null;
  return { sel, ent: arr[sel.index] };
}

function acadEntityLayerName(ent) {
  return ent?.layer || acadState.currentLayer || '0';
}

function acadEntityDescriptor(sel, ent) {
  if (!sel || !ent) return '—';
  if (sel.type === 'line') {
    const len = Math.hypot((ent.x2 || 0) - (ent.x1 || 0), (ent.y2 || 0) - (ent.y1 || 0));
    return `LINE · ${len.toFixed(2)}`;
  }
  if (sel.type === 'circle') return `CIRCLE · r=${Number(ent.r || 0).toFixed(2)}`;
  if (sel.type === 'arc') return `ARC · r=${Number(ent.r || 0).toFixed(2)}`;
  if (sel.type === 'text') return `TEXT · ${String(ent.text || '').slice(0, 28)}`;
  return `${sel.type.toUpperCase()} #${sel.index}`;
}

function acadSelectedPropertyRows() {
  const first = acadFirstSelection();
  if (!first) {
    return [
      ['Selection', 'None'],
      ['Current layer', acadState.currentLayer],
      ['Current tool', acadToolLabel(acadState.tool)],
    ];
  }
  const { sel, ent } = first;
  const rows = [
    ['Type', sel.type.toUpperCase()],
    ['Index', `#${sel.index}`],
    ['Layer', acadEntityLayerName(ent)],
    ['Summary', acadEntityDescriptor(sel, ent)],
  ];
  if ('x1' in ent) rows.push(['Start', `${Number(ent.x1).toFixed(2)}, ${Number(ent.y1).toFixed(2)}`]);
  if ('x2' in ent) rows.push(['End', `${Number(ent.x2).toFixed(2)}, ${Number(ent.y2).toFixed(2)}`]);
  if ('cx' in ent) rows.push(['Center', `${Number(ent.cx).toFixed(2)}, ${Number(ent.cy).toFixed(2)}`]);
  if ('r' in ent) rows.push(['Radius', Number(ent.r).toFixed(2)]);
  return rows;
}

function acadGeometryRows() {
  const counts = scanEntityCounts();
  const bounds = acadEntityBounds();
  const rows = [
    ['Total entities', String(counts.total)],
    ['Visible entities', String(acadAllEntities().length)],
    ['Layers', String(acadState.layers.length)],
  ];
  if (bounds) {
    rows.push(['Width', (bounds.maxX - bounds.minX).toFixed(2)]);
    rows.push(['Height', (bounds.maxY - bounds.minY).toFixed(2)]);
    rows.push(['BBox min', `${bounds.minX.toFixed(2)}, ${bounds.minY.toFixed(2)}`]);
    rows.push(['BBox max', `${bounds.maxX.toFixed(2)}, ${bounds.maxY.toFixed(2)}`]);
  } else {
    rows.push(['Width', '—']);
    rows.push(['Height', '—']);
  }
  return rows;
}

function acadUpdateWorkbenchPanels(visibleEntities = null) {
  const typeRows = acadTypeRows();
  const total = scanEntityCounts().total;
  const treeCount = document.getElementById('acadTreeCount');
  const typeCount = document.getElementById('acadEntityTypeCount');
  const modelTree = document.getElementById('acadModelTree');
  const entityTree = document.getElementById('acadEntityTree');
  const propInfo = document.getElementById('acadPropertyInfo');
  const geometryStats = document.getElementById('acadGeometryStats');
  const health = document.getElementById('acadCadHealth');
  const searchCount = document.getElementById('acadSearchResultCount');
  const similarCount = document.getElementById('acadSimilarFileCount');
  const duplicateCount = document.getElementById('acadDuplicateGroupCount');

  if (treeCount) treeCount.textContent = String(total);
  if (typeCount) typeCount.textContent = String(typeRows.length);
  if (modelTree) {
    const filename = scanState.file?.name || t('acad.untitled');
    modelTree.innerHTML = [
      `<div class="acad-tree-row"><b>${escHtml(filename)}</b><span>${total}</span></div>`,
      `<div class="acad-tree-row acad-tree-indent"><b>Body / Sketch</b><span>${(visibleEntities || acadAllEntities()).length}</span></div>`,
      `<div class="acad-tree-row acad-tree-indent"><b>Layers</b><span>${acadState.layers.length}</span></div>`,
    ].join('');
  }
  if (entityTree) {
    entityTree.innerHTML = typeRows.length
      ? typeRows.map(item => `<div class="acad-soft-item"><strong>${acadTypeLabel(item.key)}</strong><span>${item.count}</span></div>`).join('')
      : '<div class="acad-soft-item"><strong>No entities</strong><span>0</span></div>';
  }
  if (propInfo) propInfo.innerHTML = acadPropRows(acadSelectedPropertyRows());
  if (geometryStats) geometryStats.innerHTML = acadPropRows(acadGeometryRows());
  if (health) health.textContent = total > 0 ? 'Ready' : 'Empty';
  if (searchCount) searchCount.textContent = searchState.results?.total_matches ?? '—';
  if (similarCount) similarCount.textContent = compareState.items?.length ? String(compareState.items.length) : '—';
  if (duplicateCount) duplicateCount.textContent = dupState?.total ? String(dupState.total) : '—';
}

function acadUpdateSelectionInfo() {
  const el = document.getElementById('acadSelectionInfo');
  if (!el) return;
  if (!acadState.selection.length) {
    el.innerHTML = acadPropRows([['Selection', 'None'], ['Tool', acadToolLabel(acadState.tool)]]);
    acadUpdateWorkbenchPanels();
    return;
  }
  const by = {};
  acadState.selection.forEach(s => { by[s.type] = (by[s.type] || 0) + 1; });
  const rows = [['Selected', String(acadState.selection.length)]]
    .concat(Object.entries(by).map(([k, v]) => [k.toUpperCase(), String(v)]));
  el.innerHTML = acadPropRows(rows);
  acadUpdateWorkbenchPanels();
}

function acadEraseSelection() {
  if (!acadState.selection.length) return;
  acadSnapshot();
  // Her tip için index'leri azalan sırada sil
  const grouped = {};
  acadState.selection.forEach(s => {
    if (!grouped[s.type]) grouped[s.type] = [];
    grouped[s.type].push(s.index);
  });
  Object.entries(grouped).forEach(([type, idxs]) => {
    idxs.sort((a,b) => b - a).forEach(i => scanState.entities[type + 's'].splice(i, 1));
  });
  acadLog(`${acadState.selection.length} nesne silindi.`, 'cmd-ok');
  acadState.selection = [];
  acadUpdateSelectionInfo();
  acadRender();
}

// ─── Geometri yardımcıları ─────────────────────────────────────────
function acadArc3pt(p1, p2, p3) {
  // 3 noktadan geçen çemberin merkezi + yarıçap + açılar
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax*ax + ay*ay) * (by - cy) + (bx*bx + by*by) * (cy - ay) + (cx*cx + cy*cy) * (ay - by)) / d;
  const uy = ((ax*ax + ay*ay) * (cx - bx) + (bx*bx + by*by) * (ax - cx) + (cx*cx + cy*cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a1 = Math.atan2(ay - uy, ax - ux);
  let a3 = Math.atan2(cy - uy, cx - ux);
  // start→end yönünü belirle (p2 ortada kalacak şekilde)
  return { cx: ux, cy: uy, r, start: a1, end: a3 };
}

function acadPolygonPoints(center, edge, sides) {
  const r = Math.hypot(edge.x - center.x, edge.y - center.y);
  const a0 = Math.atan2(edge.y - center.y, edge.x - center.x);
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = a0 + (2 * Math.PI * i) / sides;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return pts;
}

function acadPolygonSvg(center, edge, sides, stroke, dash) {
  const pts = acadPolygonPoints(center, edge, sides).map(p => acadW2S(p.x, p.y));
  const d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ') + ' Z';
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="${dash || '5 3'}"/>`;
}

function acadShiftEntityInPlace(e, dx, dy) {
  if ('x1' in e) { e.x1 += dx; e.x2 += dx; e.y1 += dy; e.y2 += dy; }
  if ('cx' in e) { e.cx += dx; e.cy += dy; }
  if ('ox' in e) { e.ox += dx; e.oy += dy; }
  if (e.points) e.points = e.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
}
function acadShiftEntity(e, dx, dy) {
  const cp = JSON.parse(JSON.stringify(e));
  acadShiftEntityInPlace(cp, dx, dy);
  return cp;
}
function acadRotateEntity(e, cx, cy, ang) {
  const cp = JSON.parse(JSON.stringify(e));
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const rot = (x, y) => ({ x: cx + (x - cx) * cos - (y - cy) * sin, y: cy + (x - cx) * sin + (y - cy) * cos });
  if ('x1' in cp) { const a = rot(cp.x1, cp.y1), b = rot(cp.x2, cp.y2); cp.x1=a.x;cp.y1=a.y;cp.x2=b.x;cp.y2=b.y; }
  if ('cx' in cp) { const a = rot(cp.cx, cp.cy); cp.cx=a.x;cp.cy=a.y;
    if ('start_angle' in cp) { cp.start_angle += ang * 180 / Math.PI; cp.end_angle += ang * 180 / Math.PI; }
  }
  if ('ox' in cp) { const a = rot(cp.ox, cp.oy); cp.ox=a.x;cp.oy=a.y; }
  if (cp.points) cp.points = cp.points.map(p => rot(p.x, p.y));
  return cp;
}

function acadPreviewTransform(sel, fn) {
  const parts = [];
  sel.forEach(s => {
    const arr = scanState.entities[s.type + 's'];
    if (!arr || !arr[s.index]) return;
    const tmp = fn(arr[s.index]);
    parts.push(acadRenderEntity(tmp, s.type, -1, '#ffb400', 1));
  });
  return `<g opacity="0.7">${parts.join('')}</g>`;
}

// ─── Offset — sadece line / circle / arc ───────────────────────────
function acadOffsetEntity(src, type, dist, sidePt) {
  if (type === 'line') {
    const vx = src.x2 - src.x1, vy = src.y2 - src.y1;
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy / len, ny = vx / len; // sol normal
    // Hangi tarafa: sidePt'nin normal ile hizası
    const mx = (src.x1 + src.x2) / 2, my = (src.y1 + src.y2) / 2;
    const sign = ((sidePt.x - mx) * nx + (sidePt.y - my) * ny) >= 0 ? 1 : -1;
    const ox = nx * dist * sign, oy = ny * dist * sign;
    return { type: 'LINE', x1: src.x1 + ox, y1: src.y1 + oy, x2: src.x2 + ox, y2: src.y2 + oy, layer: src.layer };
  }
  if (type === 'circle') {
    const d = Math.hypot(sidePt.x - src.cx, sidePt.y - src.cy);
    const newR = d >= src.r ? src.r + dist : Math.max(0.01, src.r - dist);
    return { type: 'CIRCLE', cx: src.cx, cy: src.cy, r: newR, layer: src.layer };
  }
  if (type === 'arc') {
    const d = Math.hypot(sidePt.x - src.cx, sidePt.y - src.cy);
    const newR = d >= src.r ? src.r + dist : Math.max(0.01, src.r - dist);
    return { type: 'ARC', cx: src.cx, cy: src.cy, r: newR, start_angle: src.start_angle, end_angle: src.end_angle, layer: src.layer };
  }
  return null;
}

// ─── Trim / Extend (basit) ─────────────────────────────────────────
function acadDoTrim(pt) {
  // Tıklanan çizginin tıklanan ucunu, en yakın kesişene kadar budar.
  const hit = acadHitTest(pt, {});
  if (!hit || hit.type !== 'line') { acadLog('TRIM: Bir çizgiye tıklayın.', 'cmd-err'); return; }
  const arr = scanState.entities.lines;
  const L = arr[hit.index];
  // Tüm diğer çizgilerle kesişim noktalarını bul
  const intersections = [];
  arr.forEach((L2, j) => {
    if (j === hit.index) return;
    const ip = acadLineLineIntersect(L, L2);
    if (ip) intersections.push(ip);
  });
  if (!intersections.length) { acadLog('TRIM: Kesişim bulunamadı.', 'cmd-err'); return; }
  // Tıklanan uç hangisi?
  const d1 = Math.hypot(pt.x - L.x1, pt.y - L.y1);
  const d2 = Math.hypot(pt.x - L.x2, pt.y - L.y2);
  const endNear = d1 < d2 ? 1 : 2;
  // endNear'ye en yakın kesişimi bul
  let best = null;
  intersections.forEach(ip => {
    const d = Math.hypot(ip.x - (endNear === 1 ? L.x1 : L.x2), ip.y - (endNear === 1 ? L.y1 : L.y2));
    if (!best || d < best.d) best = { d, ip };
  });
  if (!best) return;
  acadSnapshot();
  if (endNear === 1) { L.x1 = best.ip.x; L.y1 = best.ip.y; }
  else { L.x2 = best.ip.x; L.y2 = best.ip.y; }
  acadLog('TRIM: Çizgi budandı.', 'cmd-ok');
  acadRender();
}

function acadDoExtend(pt) {
  const hit = acadHitTest(pt, {});
  if (!hit || hit.type !== 'line') { acadLog('EXTEND: Bir çizgiye tıklayın.', 'cmd-err'); return; }
  const arr = scanState.entities.lines;
  const L = arr[hit.index];
  // Tıklanan uç
  const d1 = Math.hypot(pt.x - L.x1, pt.y - L.y1);
  const d2 = Math.hypot(pt.x - L.x2, pt.y - L.y2);
  const endNear = d1 < d2 ? 1 : 2;
  // Çizginin yönünde sonsuz hat sayıp en yakın kesişene kadar uzat
  const ex = endNear === 1 ? L.x1 : L.x2;
  const ey = endNear === 1 ? L.y1 : L.y2;
  const ox = endNear === 1 ? L.x2 : L.x1;
  const oy = endNear === 1 ? L.y2 : L.y1;
  const dx = ex - ox, dy = ey - oy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // Her diğer çizgiyle kesişim: sonsuz hat versiyonu
  let best = null;
  arr.forEach((L2, j) => {
    if (j === hit.index) return;
    const ip = acadRayLineIntersect({ x: ex, y: ey, ux, uy }, L2);
    if (ip && ip.t > 0.001) {
      if (!best || ip.t < best.t) best = { t: ip.t, x: ip.x, y: ip.y };
    }
  });
  if (!best) { acadLog('EXTEND: Kesişim yok.', 'cmd-err'); return; }
  acadSnapshot();
  if (endNear === 1) { L.x1 = best.x; L.y1 = best.y; }
  else { L.x2 = best.x; L.y2 = best.y; }
  acadLog('EXTEND: Çizgi uzatıldı.', 'cmd-ok');
  acadRender();
}

function acadLineLineIntersect(A, B) {
  const x1=A.x1,y1=A.y1,x2=A.x2,y2=A.y2;
  const x3=B.x1,y3=B.y1,x4=B.x2,y4=B.y2;
  const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den;
  const u = -((x1-x2)*(y1-y3) - (y1-y2)*(x1-x3)) / den;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return { x: x1 + t*(x2-x1), y: y1 + t*(y2-y1) };
}
function acadRayLineIntersect(R, L) {
  // R: {x,y,ux,uy} ışın; L: çizgi
  const x3=L.x1,y3=L.y1,x4=L.x2,y4=L.y2;
  const den = R.ux * (y3 - y4) - R.uy * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x3 - R.x) * (y3 - y4) - (y3 - R.y) * (x3 - x4)) / den;
  const u = -(-R.uy * (x3 - R.x) + R.ux * (y3 - R.y)) / den;
  // t: ışın parametresi (ileri >0), u: segment (0..1)
  if (u < -0.001 || u > 1.001) return null;
  return { t, x: R.x + R.ux * t, y: R.y + R.uy * t };
}

// ─── Katman paneli ──────────────────────────────────────────────────
function acadRenderLayers() {
  const el = document.getElementById('acadLayerList');
  if (!el) return;
  el.innerHTML = acadState.layers.map(L => {
    const isCur = L.name === acadState.currentLayer;
    return `
      <div class="acad-layer-row ${isCur ? 'current' : ''}" onclick="acadSetCurrentLayer('${L.name}')">
        <span class="lcol" style="background:${L.color}" onclick="event.stopPropagation();acadPickLayerColor('${L.name}')" title="Renk"></span>
        <span class="lname" title="${L.name}">${L.name}</span>
        <span class="lico ${L.visible ? '' : 'off'}" onclick="event.stopPropagation();acadToggleLayerVis('${L.name}')" title="${L.visible ? 'Görünür' : 'Gizli'}">${L.visible ? '👁' : '—'}</span>
        <span class="lico ${L.locked ? '' : 'off'}" onclick="event.stopPropagation();acadToggleLayerLock('${L.name}')" title="${L.locked ? 'Kilitli' : 'Açık'}">${L.locked ? '🔒' : '🔓'}</span>
        <span class="lico" onclick="event.stopPropagation();acadDeleteLayer('${L.name}')" title="Sil">×</span>
      </div>`;
  }).join('');
}
function acadLayerAdd() {
  const name = prompt('Yeni katman adı:');
  if (!name) return;
  if (acadState.layers.some(l => l.name === name)) { acadLog('Bu ad zaten var.', 'cmd-err'); return; }
  acadState.layers.push({ name, color: '#ffffff', visible: true, locked: false });
  acadRenderLayers();
  acadLog(`Katman eklendi: ${name}`, 'cmd-ok');
}
function acadSetCurrentLayer(name) {
  acadState.currentLayer = name;
  acadRenderLayers(); acadRender();
}
function acadToggleLayerVis(name) {
  const L = acadState.layers.find(l => l.name === name); if (!L) return;
  L.visible = !L.visible; acadRenderLayers(); acadRender();
}
function acadToggleLayerLock(name) {
  const L = acadState.layers.find(l => l.name === name); if (!L) return;
  L.locked = !L.locked; acadRenderLayers(); acadRender();
}
function acadPickLayerColor(name) {
  const L = acadState.layers.find(l => l.name === name); if (!L) return;
  const c = prompt('Renk kodu (örn #ffb400):', L.color);
  if (c) { L.color = c; acadRenderLayers(); acadRender(); }
}
function acadDeleteLayer(name) {
  if (acadState.layers.length <= 1) { acadLog('En az bir katman gerekli.', 'cmd-err'); return; }
  if (!confirm(`"${name}" katmanını sil? (Bu katmandaki nesneler "0" katmanına taşınacak)`)) return;
  // Nesneleri 0'a taşı
  ['lines','circles','arcs','polylines','rectangles','polygons','dimensions','texts'].forEach(k => {
    (scanState.entities[k] || []).forEach(o => { if (o.layer === name) o.layer = '0'; });
  });
  acadState.layers = acadState.layers.filter(l => l.name !== name);
  if (acadState.currentLayer === name) acadState.currentLayer = acadState.layers[0].name;
  acadRenderLayers(); acadRender();
}

// ─── Komut satırı parser ──────────────────────────────────────────
const ACAD_CMD_MAP = {
  // ── Çizim (Draw) ──
  L: 'line', LINE: 'line',
  C: 'circle', CIR: 'circle', CIRCLE: 'circle',
  A: 'arc', ARC: 'arc',
  REC: 'rect', RECT: 'rect', RECTANGLE: 'rect',
  PL: 'polyline', POLYLINE: 'polyline',
  POL: 'polygon', POLY: 'polygon', POLYGON: 'polygon',
  EL: 'ellipse', ELLIPSE: 'ellipse',
  PO: 'point', POINT: 'point',
  T: 'text', DT: 'text', TEXT: 'text', MTEXT: 'text',
  XL: 'xline', XLINE: 'xline',
  RAY: 'ray',
  LE: 'leader', LEADER: 'leader', QLEADER: 'leader',
  // ── Değiştir (Modify) ──
  M: 'move', MOVE: 'move',
  CO: 'copy', COPY: 'copy', CP: 'copy',
  RO: 'rotate', ROTATE: 'rotate',
  E: 'erase', ERASE: 'erase', DEL: 'erase',
  TR: 'trim', TRIM: 'trim',
  EX: 'extend', EXTEND: 'extend',
  OFF: 'offset', OFFSET: 'offset', O: 'offset',
  MI: 'mirror', MIRROR: 'mirror',
  SC: 'scale', SCALE: 'scale',
  F: 'fillet', FILLET: 'fillet',
  CHA: 'chamfer', CHAMFER: 'chamfer',
  BR: 'break', BREAK: 'break',
  J: '__join', JOIN: '__join',
  X: '__explode', EXPLODE: '__explode',
  LEN: '__lengthen', LENGTHEN: '__lengthen',
  AR: '__array', ARRAY: '__array',
  DIV: '__divide', DIVIDE: '__divide',
  ME: '__measure', MEASURE: '__measure',
  SM: '__smooth', SMOOTH: '__smooth',
  MA: '__matchprop', MATCHPROP: '__matchprop',
  // ── Ölçü (Dimension) ──
  DLI: 'dim-lin', DIMLIN: 'dim-lin', DIMLINEAR: 'dim-lin',
  DAL: 'dim-ali', DIMALI: 'dim-ali', DIMALIGNED: 'dim-ali',
  DRA: '__dimrad', DIMRAD: '__dimrad', DIMRADIUS: '__dimrad',
  DDI: '__dimdia', DIMDIA: '__dimdia', DIMDIAMETER: '__dimdia',
  DAN: '__dimang', DIMANG: '__dimang', DIMANGULAR: '__dimang',
  // ── Seçim / Inquiry ──
  SEL: 'select', SELECT: 'select',
  DI: '__dist', DIST: '__dist',
  ID: '__id',
  AA: '__area', AREA: '__area',
  LI: '__list', LIST: '__list',
  PR: '__properties', PROPS: '__properties', PROPERTIES: '__properties',
  // ── Özel işlemler ──
  REGEN: '__regen', RE: '__regen',
  PURGE: '__purge', PU: '__purge',
  // ── Mod / Görünüm ──
  F3: '__osnap', OSNAP: '__osnap',
  F8: '__ortho', ORTHO: '__ortho',
  F9: '__grid', GSNAP: '__grid', SNAP: '__grid',
  Z: '__zoom', ZOOM: '__zoom',
  P: '__pan', PAN: '__pan',
  U: '__undo', UNDO: '__undo',
  REDO: '__redo',
  ERASE_ALL: '__clear',
  FIT: '__fit', ZE: '__fit', ZOOMEXTENTS: '__fit',
  HELP: '__help', '?': '__help',
};

function acadCmdKey(ev) {
  const inp = ev.target;
  if (ev.key === 'Enter') {
    const raw = inp.value.trim();
    inp.value = '';
    ev.preventDefault();
    if (!raw) {
      // Enter sadece — pending polyline/move/copy bitir
      acadCmdEnterOnly();
      return;
    }
    acadProcessCmd(raw);
    return;
  }
  if (ev.key === 'Escape') {
    inp.value = '';
    acadCancel();
  }
}

function acadCmdEnterOnly() {
  const p = acadState.pending;
  if (!p) {
    if (acadState.lastTool && acadState.tool === 'select') {
      acadLog(`Tekrar: ${acadToolLabel(acadState.lastTool)}`, 'cmd-ok');
      acadSetTool(acadState.lastTool);
      return;
    }
    acadLog(acadState.tool === 'select' ? 'Boş komut.' : `${acadState.tool.toUpperCase()} — tıklayın.`, '');
    return;
  }
  if (p.type === 'polyline') {
    if (p.points.length >= 2) {
      acadSnapshot();
      scanState.entities.polylines.push({
        type: 'POLYLINE', points: p.points.map(q => ({ x: q.x, y: q.y })),
        closed: !!p.closed, layer: acadState.currentLayer,
      });
      acadLog(`POLYLINE: ${p.points.length} nokta çizildi.`, 'cmd-ok');
    }
    acadState.pending = null;
    acadSetPrompt('Komut:');
    acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return;
  }
  if (p.type === 'line') {
    acadState.pending = null;
    acadSetPrompt('Komut:');
    acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return;
  }
  if (p.type === 'copy') {
    acadState.pending = null;
    acadState.selection = [];
    acadSetPrompt('Komut:');
    acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return;
  }
  acadLog('Enter: sonraki adım bekleniyor.', '');
}

function acadProcessCmd(raw) {
  const p = acadState.pending;
  const upper = raw.toUpperCase();

  // Polyline'da C = kapat
  if (p && p.type === 'polyline' && upper === 'C') {
    if (p.points.length >= 3) {
      acadSnapshot();
      scanState.entities.polylines.push({
        type: 'POLYLINE', points: p.points.map(q => ({ x: q.x, y: q.y })),
        closed: true, layer: acadState.currentLayer,
      });
      acadLog(`POLYLINE (kapalı): ${p.points.length} nokta.`, 'cmd-ok');
    }
    acadState.pending = null;
    acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return;
  }

  // Polygon kenar sayısı bekleniyorsa
  if (p && p.type === 'polygon' && p.step === 0) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 3 && n <= 64) {
      p.sides = n; p.step = 1;
      acadSetPrompt('POLYGON — Merkez noktası:');
      acadLog(`POLYGON: ${n} kenar. Merkez noktasını tıkla.`, 'cmd-ok');
    } else {
      acadLog('3-64 arası bir tamsayı girin.', 'cmd-err');
    }
    return;
  }

  // Offset mesafe
  if (p && p.type === 'offset' && p.step === 0) {
    const d = parseFloat(raw);
    if (!isNaN(d) && d > 0) {
      p.dist = d; p.step = 1;
      acadSetPrompt('OFFSET — Kopyalanacak nesneye tıkla:');
      acadLog(`OFFSET: mesafe=${d}. Nesneyi seç.`, 'cmd-ok');
    } else {
      acadLog('Pozitif sayı girin.', 'cmd-err');
    }
    return;
  }

  // Rotate: açı direkt yazılabilir
  if (p && p.type === 'rotate' && p.points.length === 1) {
    const deg = parseFloat(raw);
    if (!isNaN(deg)) {
      const ang = deg * Math.PI / 180;
      acadSnapshot();
      p.sel.forEach(s => {
        const arr = scanState.entities[s.type + 's'];
        if (arr && arr[s.index]) Object.assign(arr[s.index], acadRotateEntity(arr[s.index], p.points[0].x, p.points[0].y, ang));
      });
      acadLog(`ROTATE: ${deg}° uygulandı.`, 'cmd-ok');
      acadState.pending = null; acadState.selection = [];
      acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
      acadRender();
      return;
    }
  }

  // Komut satırı nokta/mesafe girişi:
  // x,y mutlak koordinat; @dx,dy göreli koordinat; mesafe<açı polar; tek sayı bağlama göre mesafe/radius.
  const cmdPoint = p ? acadParseCommandPoint(raw, p) : null;
  if (cmdPoint) {
    acadHandleToolClick(cmdPoint, { shiftKey: false, ctrlKey: false, button: 0 });
    return;
  }
  if (p && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) && acadApplyNumericArgument(raw, p)) {
    return;
  }

  // Komut haritası
  const mapped = ACAD_CMD_MAP[upper];
  if (!mapped) { acadLog(`Bilinmeyen komut: ${raw}`, 'cmd-err'); return; }

  switch (mapped) {
    case '__osnap': acadToggle('osnap'); acadLog(`OSNAP ${acadState.osnap ? 'ON' : 'OFF'}`, 'cmd-ok'); return;
    case '__ortho': acadToggle('ortho'); acadLog(`ORTHO ${acadState.ortho ? 'ON' : 'OFF'}`, 'cmd-ok'); return;
    case '__grid':  acadToggle('gridSnap'); acadLog(`GRID SNAP ${acadState.gridSnap ? 'ON' : 'OFF'}`, 'cmd-ok'); return;
    case '__zoom':  acadSetPrompt('ZOOM — (tekerlekle yakınlaş / FIT = komut):'); return;
    case '__pan':   acadLog('PAN: Orta fare tuşu veya Shift+Sol sürükle.', 'cmd-ok'); return;
    case '__undo':  acadUndo(); return;
    case '__redo':  acadRedo(); return;
    case '__fit':   acadFit(); acadLog('FIT: tümünü sığdır.', 'cmd-ok'); return;
    case '__clear':
      if (confirm('Tüm çizimi silmek istediğine emin misin?')) {
        acadSnapshot();
        ['lines','circles','arcs','polylines','rectangles','polygons','dimensions','texts','splines','ellipses','points','xlines','rays','leaders'].forEach(k => { if (scanState.entities[k]) scanState.entities[k] = []; });
        acadState.selection = []; acadRender();
        acadLog('Çizim temizlendi.', 'cmd-ok');
      }
      return;
    // ── Edit/inquiry komutları (anında çalışanlar) ──
    case '__join':        acadCmdJoin(); return;
    case '__explode':     acadCmdExplode(); return;
    case '__lengthen':    acadCmdLengthen(); return;
    case '__array':       acadCmdArray(); return;
    case '__divide':      acadCmdDivide(); return;
    case '__measure':     acadCmdMeasure(); return;
    case '__smooth':      acadCmdSmooth(); return;
    case '__matchprop':   acadCmdMatchprop(); return;
    case '__regen':       acadCmdRegen(); return;
    case '__purge':       acadCmdPurge(); return;
    case '__dist':        acadCmdDist(); return;
    case '__id':          acadCmdId(); return;
    case '__area':        acadCmdArea(); return;
    case '__list':        acadCmdList(); return;
    case '__properties':  acadCmdProperties(); return;
    case '__dimrad':      acadCmdDimRadius('radius'); return;
    case '__dimdia':      acadCmdDimRadius('diameter'); return;
    case '__dimang':      acadCmdDimAngular(); return;
    case '__help':
      acadLog('YARDIM — Çizim: L C A REC PL POL EL PO T XL RAY LE | Değiştir: M CO RO E TR EX OFF MI SC F CHA BR J X LEN AR DIV ME SM MA | Ölçü: DLI DAL DRA DDI DAN | Inquiry: DI ID AA LI PR | Koordinat: x,y @dx,dy mesafe<açı tek sayı | Mod: F3 F8 F9 Z P U REDO FIT REGEN PURGE HELP', 'cmd-ok');
      return;
    default:
      acadSetTool(mapped);
  }
}

// ─── Global klavye kısayolları ─────────────────────────────────────
function acadKeydown(ev) {
  if (!acadState.open) return;
  // Command line input odaktaysa sadece bazı tuşları yakala
  const inInput = document.activeElement && document.activeElement.id === 'acadCmdInput';

  if (ev.key === 'Escape') { ev.preventDefault(); acadCancel(); return; }
  if (ev.key === 'F3') { ev.preventDefault(); acadToggle('osnap'); return; }
  if (ev.key === 'F8') { ev.preventDefault(); acadToggle('ortho'); return; }
  if (ev.key === 'F9') { ev.preventDefault(); acadToggle('gridSnap'); return; }

  if (inInput) return; // input'ta harf tuşlarını yeme

  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (acadState.selection.length) { ev.preventDefault(); acadEraseSelection(); return; }
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); acadUndo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); acadRedo(); return; }

  // Tek harf kısayollar
  const k = ev.key.toLowerCase();
  const shortcuts = { l:'line', c:'circle', a:'arc', r:'rect', m:'move', e:'erase' };
  if (shortcuts[k] && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    acadSetTool(shortcuts[k]);
  }
}

// ─── DXF / SVG export (yeni tipleri lines/arcs/circles/texts'e düzleştir) ───
function acadFlattenForExport() {
  // scanState.entities'ın backend'in anladığı versiyonunu döndür
  const src = scanState.entities;
  const out = {
    width: src.width || 500, height: src.height || 500,
    lines: [...(src.lines || [])], circles: [...(src.circles || [])],
    arcs: [...(src.arcs || [])], texts: [...(src.texts || [])],
  };
  // Rectangle → 4 line
  (src.rectangles || []).forEach(r => {
    out.lines.push(
      { type:'LINE', x1:r.x1,y1:r.y1, x2:r.x2,y2:r.y1 },
      { type:'LINE', x1:r.x2,y1:r.y1, x2:r.x2,y2:r.y2 },
      { type:'LINE', x1:r.x2,y1:r.y2, x2:r.x1,y2:r.y2 },
      { type:'LINE', x1:r.x1,y1:r.y2, x2:r.x1,y2:r.y1 },
    );
  });
  // Polyline → lines
  (src.polylines || []).forEach(p => {
    const pts = p.points || [];
    for (let i = 0; i < pts.length - 1; i++) {
      out.lines.push({ type:'LINE', x1: pts[i].x, y1: pts[i].y, x2: pts[i+1].x, y2: pts[i+1].y });
    }
    if (p.closed && pts.length >= 2) {
      out.lines.push({ type:'LINE', x1: pts[pts.length-1].x, y1: pts[pts.length-1].y, x2: pts[0].x, y2: pts[0].y });
    }
  });
  // Polygon → kapalı lines
  (src.polygons || []).forEach(p => {
    const pts = p.points || [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i+1) % pts.length];
      out.lines.push({ type:'LINE', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  });
  // Dimension → line + text
  (src.dimensions || []).forEach(d => {
    out.lines.push({ type:'LINE', x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 });
    const mx = (d.x1 + d.x2) / 2, my = (d.y1 + d.y2) / 2;
    const dist = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    out.texts.push({ type:'TEXT', x: mx, y: my, text: d.text || dist.toFixed(2), height: 10 });
  });
  // Spline → 24 örneklik lines
  (src.splines || []).forEach(s => {
    const samples = acadSplineSamples(s, 24);
    for (let i = 0; i < samples.length - 1; i++) {
      out.lines.push({ type:'LINE', x1: samples[i].x, y1: samples[i].y, x2: samples[i+1].x, y2: samples[i+1].y });
    }
  });
  // splines'ı da ekle, backend anlıyor olabilir
  if ((src.splines || []).length) out.splines = src.splines;
  // Ellipse → sampled lines
  (src.ellipses || []).forEach(el => {
    const samples = acadEllipseSamples(el, 48);
    for (let i = 0; i < samples.length - 1; i++) {
      out.lines.push({ type:'LINE', x1: samples[i].x, y1: samples[i].y, x2: samples[i+1].x, y2: samples[i+1].y });
    }
  });
  // Xline / Ray → görünür alan içinde kırpılmış line
  (src.xlines || []).forEach(x => {
    const rad = (x.angle || 0) * Math.PI / 180;
    const L = 1e4;
    out.lines.push({ type:'LINE', x1: x.x - Math.cos(rad) * L, y1: x.y - Math.sin(rad) * L,
                     x2: x.x + Math.cos(rad) * L, y2: x.y + Math.sin(rad) * L });
  });
  (src.rays || []).forEach(r => {
    const rad = (r.angle || 0) * Math.PI / 180;
    const L = 1e4;
    out.lines.push({ type:'LINE', x1: r.x, y1: r.y,
                     x2: r.x + Math.cos(rad) * L, y2: r.y + Math.sin(rad) * L });
  });
  // Point → küçük çapraz (+), 2 line
  (src.points || []).forEach(p => {
    out.lines.push({ type:'LINE', x1: p.x - 2, y1: p.y, x2: p.x + 2, y2: p.y });
    out.lines.push({ type:'LINE', x1: p.x, y1: p.y - 2, x2: p.x, y2: p.y + 2 });
  });
  // Leader → 2 line + arrow as short line + text
  (src.leaders || []).forEach(l => {
    out.lines.push({ type:'LINE', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 });
    out.lines.push({ type:'LINE', x1: l.x2, y1: l.y2, x2: l.x3, y2: l.y3 });
    if (l.text) out.texts.push({ type:'TEXT', x: l.x3 + 4, y: l.y3 + 4, text: l.text, height: 10 });
  });
  // Text → out.texts'e aktar (zaten var ama layer aktarılsın)
  // (src.texts zaten out.texts'te baştan kopyalandı, burada dokunmuyoruz)
  return out;
}

// CAD Pro topbar export butonları
async function acadExportDXF() {
  acadLog('DXF oluşturuluyor...', 'cmd-ok');
  await scanExportDXF();
}

function acadExportSVG() {
  const svg = document.getElementById('acadSvg');
  if (!svg) return;
  // Saf bir SVG üret: arka planı beyaza çevir, crosshair/snap işaretlerini kaldır
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Arkaplanı beyaza çevir (yazdırma için)
  clone.querySelectorAll('rect').forEach(r => {
    if (r.getAttribute('fill') === '#1e2023') r.setAttribute('fill', '#ffffff');
  });
  // Grid satırlarını temizle (opacity < 0.6 olanlar)
  clone.querySelectorAll('g[opacity="0.35"], g[opacity="0.55"]').forEach(g => g.remove());
  // Crosshair'ı kaldır (stroke-dasharray olan ffb400 çizgiler)
  clone.querySelectorAll('line[stroke="#ffb400"][stroke-dasharray]').forEach(l => l.remove());
  clone.querySelectorAll('.acad-snap-marker').forEach(s => s.remove());
  // Tüm stroke'ları siyaha çevir (yazdırma için)
  clone.querySelectorAll('[stroke="#ffffff"], [stroke="#ffb400"], [stroke="#3b82f6"], [stroke="#22c55e"], [stroke="#94a3b8"]').forEach(el => {
    el.setAttribute('stroke', '#000000');
  });
  const serialized = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialized], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (scanState.file?.name.replace(/\.[^.]+$/, '') || 'cadpro') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
  acadLog('SVG indirildi.', 'cmd-ok');
}

// ═══════════════════════════════════════════════════════════════════
// AutoCAD STANDART KOMUTLARI (Edit / Inquiry / Special / Dim Variants)
// ═══════════════════════════════════════════════════════════════════

// ─── JOIN ─ seçili uç uca temas eden line'ları polyline'a çevir ────
function acadCmdJoin() {
  const sel = acadState.selection.filter(s => s.type === 'line');
  if (sel.length < 2) { acadLog('JOIN: En az 2 çizgi seçin.', 'cmd-err'); return; }
  const lines = sel.map(s => scanState.entities.lines[s.index]);
  const TOL = 0.1;
  const eq = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < TOL;
  // Basit chain: ilk satırdan başla, uç noktalara bitişen sonraki ekle
  const remaining = [...lines];
  const chain = [remaining.shift()];
  let changed = true;
  while (changed && remaining.length) {
    changed = false;
    for (let i = 0; i < remaining.length; i++) {
      const L = remaining[i];
      const first = chain[0], last = chain[chain.length - 1];
      if (eq({x:last.x2,y:last.y2}, {x:L.x1,y:L.y1})) { chain.push(L); remaining.splice(i,1); changed = true; break; }
      if (eq({x:last.x2,y:last.y2}, {x:L.x2,y:L.y2})) { chain.push({x1:L.x2,y1:L.y2,x2:L.x1,y2:L.y1}); remaining.splice(i,1); changed = true; break; }
      if (eq({x:first.x1,y:first.y1}, {x:L.x2,y:L.y2})) { chain.unshift(L); remaining.splice(i,1); changed = true; break; }
      if (eq({x:first.x1,y:first.y1}, {x:L.x1,y:L.y1})) { chain.unshift({x1:L.x2,y1:L.y2,x2:L.x1,y2:L.y1}); remaining.splice(i,1); changed = true; break; }
    }
  }
  if (chain.length < 2) { acadLog('JOIN: Uç uca temas bulunamadı.', 'cmd-err'); return; }
  acadSnapshot();
  // Çizgileri sil (azalan index)
  const idxs = sel.slice(0, chain.length).map(s => s.index).sort((a,b) => b-a);
  idxs.forEach(i => scanState.entities.lines.splice(i, 1));
  // Polyline oluştur
  const pts = [{x: chain[0].x1, y: chain[0].y1}, ...chain.map(c => ({x: c.x2, y: c.y2}))];
  const closed = eq(pts[0], pts[pts.length-1]);
  if (closed) pts.pop();
  scanState.entities.polylines.push({
    type:'POLYLINE', points: pts, closed, layer: acadState.currentLayer,
  });
  acadLog(`JOIN: ${chain.length} çizgi → 1 polyline (${closed?'kapalı':'açık'})`, 'cmd-ok');
  acadState.selection = [];
  acadUpdateSelectionInfo(); acadRender();
}

// ─── EXPLODE ─ polyline/rect/polygon → ayrı line'lar ──────────────
function acadCmdExplode() {
  if (!acadState.selection.length) { acadLog('EXPLODE: Önce bir polyline/rectangle/polygon seç.', 'cmd-err'); return; }
  acadSnapshot();
  const byType = {};
  acadState.selection.forEach(s => { (byType[s.type] = byType[s.type] || []).push(s.index); });
  let count = 0;
  const ly = acadState.currentLayer;
  ['polyline','rectangle','polygon'].forEach(t => {
    (byType[t] || []).sort((a,b)=>b-a).forEach(i => {
      const ent = scanState.entities[t + 's'][i];
      if (t === 'polyline') {
        const pts = ent.points;
        for (let k = 0; k < pts.length - 1; k++) {
          scanState.entities.lines.push({ type:'LINE', x1:pts[k].x,y1:pts[k].y, x2:pts[k+1].x,y2:pts[k+1].y, layer: ent.layer || ly }); count++;
        }
        if (ent.closed && pts.length >= 2) {
          scanState.entities.lines.push({ type:'LINE', x1:pts[pts.length-1].x,y1:pts[pts.length-1].y, x2:pts[0].x,y2:pts[0].y, layer: ent.layer || ly }); count++;
        }
      } else if (t === 'rectangle') {
        const pts = [{x:ent.x1,y:ent.y1},{x:ent.x2,y:ent.y1},{x:ent.x2,y:ent.y2},{x:ent.x1,y:ent.y2}];
        for (let k = 0; k < 4; k++) {
          scanState.entities.lines.push({ type:'LINE', x1:pts[k].x,y1:pts[k].y, x2:pts[(k+1)%4].x,y2:pts[(k+1)%4].y, layer: ent.layer || ly }); count++;
        }
      } else {
        const pts = ent.points;
        for (let k = 0; k < pts.length; k++) {
          scanState.entities.lines.push({ type:'LINE', x1:pts[k].x,y1:pts[k].y, x2:pts[(k+1)%pts.length].x,y2:pts[(k+1)%pts.length].y, layer: ent.layer || ly }); count++;
        }
      }
      scanState.entities[t + 's'].splice(i, 1);
    });
  });
  acadLog(`EXPLODE: ${count} çizgi üretildi.`, 'cmd-ok');
  acadState.selection = []; acadUpdateSelectionInfo(); acadRender();
}

// ─── FILLET ─ iki çizginin köşesine yay ekle (yarıçap sorar) ───────
function acadCmdFilletStart() {
  const radStr = prompt('FILLET yarıçapı (örn: 5):', '5');
  const radius = parseFloat(radStr);
  if (isNaN(radius) || radius <= 0) { acadLog('FILLET: Geçersiz yarıçap.', 'cmd-err'); return; }
  acadState.pending = { type: 'fillet', step: 0, radius, points: [], lines: [] };
  acadSetPrompt(`FILLET (r=${radius}) — Birinci çizgiyi seç:`);
  acadLog(`FILLET: yarıçap=${radius}. İki çizgiye sırayla tıkla.`, 'cmd-ok');
}
function acadFilletApply(L1, L2, radius) {
  // İki çizgi arasındaki köşeyi yay ile yumuşat
  const ip = acadLineLineIntersect(L1, L2) || acadInfiniteLineIntersect(L1, L2);
  if (!ip) { acadLog('FILLET: Çizgiler paralel.', 'cmd-err'); return false; }
  // Her çizgi için IP'ye en yakın ucu bul
  const near1 = Math.hypot(L1.x1-ip.x, L1.y1-ip.y) < Math.hypot(L1.x2-ip.x, L1.y2-ip.y) ? 1 : 2;
  const near2 = Math.hypot(L2.x1-ip.x, L2.y1-ip.y) < Math.hypot(L2.x2-ip.x, L2.y2-ip.y) ? 1 : 2;
  // Yönler (IP'den uzağa)
  const far1 = near1 === 1 ? {x:L1.x2,y:L1.y2} : {x:L1.x1,y:L1.y1};
  const far2 = near2 === 1 ? {x:L2.x2,y:L2.y2} : {x:L2.x1,y:L2.y1};
  const u1x = far1.x - ip.x, u1y = far1.y - ip.y; const u1l = Math.hypot(u1x,u1y) || 1;
  const u2x = far2.x - ip.x, u2y = far2.y - ip.y; const u2l = Math.hypot(u2x,u2y) || 1;
  const n1 = {x: u1x/u1l, y: u1y/u1l};
  const n2 = {x: u2x/u2l, y: u2y/u2l};
  // Aradaki açı
  const cosA = n1.x*n2.x + n1.y*n2.y;
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  if (Math.abs(Math.sin(A/2)) < 1e-6) { acadLog('FILLET: Çizgiler aynı hizada.', 'cmd-err'); return false; }
  const trimLen = radius / Math.tan(A / 2);
  // Tangent noktaları
  const T1 = {x: ip.x + n1.x * trimLen, y: ip.y + n1.y * trimLen};
  const T2 = {x: ip.x + n2.x * trimLen, y: ip.y + n2.y * trimLen};
  // Merkez: bisektör üzerinde, IP'den radius/sin(A/2) uzakta
  const bx = (n1.x + n2.x) / 2, by = (n1.y + n2.y) / 2;
  const bl = Math.hypot(bx, by) || 1;
  const dist = radius / Math.sin(A / 2);
  const C = {x: ip.x + (bx/bl) * dist, y: ip.y + (by/bl) * dist};
  // Çizgileri güncelle
  if (near1 === 1) { L1.x1 = T1.x; L1.y1 = T1.y; } else { L1.x2 = T1.x; L1.y2 = T1.y; }
  if (near2 === 1) { L2.x1 = T2.x; L2.y1 = T2.y; } else { L2.x2 = T2.x; L2.y2 = T2.y; }
  // Yay: merkeze göre T1 ve T2'nin açıları
  const a1 = Math.atan2(T1.y - C.y, T1.x - C.x) * 180 / Math.PI;
  const a2 = Math.atan2(T2.y - C.y, T2.x - C.x) * 180 / Math.PI;
  scanState.entities.arcs.push({ type:'ARC', cx: C.x, cy: C.y, r: radius, start_angle: a1, end_angle: a2, layer: acadState.currentLayer });
  return true;
}
function acadInfiniteLineIntersect(A, B) {
  const x1=A.x1,y1=A.y1,x2=A.x2,y2=A.y2;
  const x3=B.x1,y3=B.y1,x4=B.x2,y4=B.y2;
  const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den;
  return { x: x1 + t*(x2-x1), y: y1 + t*(y2-y1) };
}

// ─── CHAMFER ─ iki çizgi köşesini kırp ────────────────────────────
function acadCmdChamferStart() {
  const dStr = prompt('CHAMFER mesafesi (örn: 5):', '5');
  const d = parseFloat(dStr);
  if (isNaN(d) || d <= 0) { acadLog('CHAMFER: Geçersiz mesafe.', 'cmd-err'); return; }
  acadState.pending = { type: 'chamfer', step: 0, dist: d, points: [], lines: [] };
  acadSetPrompt(`CHAMFER (d=${d}) — Birinci çizgi:`);
  acadLog(`CHAMFER: mesafe=${d}. İki çizgiye tıkla.`, 'cmd-ok');
}
function acadChamferApply(L1, L2, dist) {
  const ip = acadInfiniteLineIntersect(L1, L2);
  if (!ip) { acadLog('CHAMFER: Çizgiler paralel.', 'cmd-err'); return false; }
  const near1 = Math.hypot(L1.x1-ip.x, L1.y1-ip.y) < Math.hypot(L1.x2-ip.x, L1.y2-ip.y) ? 1 : 2;
  const near2 = Math.hypot(L2.x1-ip.x, L2.y1-ip.y) < Math.hypot(L2.x2-ip.x, L2.y2-ip.y) ? 1 : 2;
  const far1 = near1 === 1 ? {x:L1.x2,y:L1.y2} : {x:L1.x1,y:L1.y1};
  const far2 = near2 === 1 ? {x:L2.x2,y:L2.y2} : {x:L2.x1,y:L2.y1};
  const u1x = far1.x - ip.x, u1y = far1.y - ip.y; const u1l = Math.hypot(u1x,u1y) || 1;
  const u2x = far2.x - ip.x, u2y = far2.y - ip.y; const u2l = Math.hypot(u2x,u2y) || 1;
  const T1 = {x: ip.x + (u1x/u1l) * dist, y: ip.y + (u1y/u1l) * dist};
  const T2 = {x: ip.x + (u2x/u2l) * dist, y: ip.y + (u2y/u2l) * dist};
  if (near1 === 1) { L1.x1 = T1.x; L1.y1 = T1.y; } else { L1.x2 = T1.x; L1.y2 = T1.y; }
  if (near2 === 1) { L2.x1 = T2.x; L2.y1 = T2.y; } else { L2.x2 = T2.x; L2.y2 = T2.y; }
  scanState.entities.lines.push({ type:'LINE', x1: T1.x, y1: T1.y, x2: T2.x, y2: T2.y, layer: acadState.currentLayer });
  return true;
}

// ─── MIRROR ─ seçimi 2 noktaya göre yansıt ────────────────────────
function acadCmdMirrorStart() {
  if (!acadState.selection.length) { acadLog('MIRROR: Önce nesne seç.', 'cmd-err'); return; }
  acadState.pending = { type: 'mirror', step: 0, points: [], sel: [...acadState.selection] };
  acadSetPrompt('MIRROR — Yansıma çizgisi 1. noktası:');
}
function acadMirrorEntity(e, p1, p2) {
  const cp = JSON.parse(JSON.stringify(e));
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len2 = dx*dx + dy*dy || 1;
  const mir = (x, y) => {
    const t = ((x - p1.x) * dx + (y - p1.y) * dy) / len2;
    const fx = p1.x + dx * t, fy = p1.y + dy * t;
    return { x: 2 * fx - x, y: 2 * fy - y };
  };
  if ('x1' in cp) { const a = mir(cp.x1, cp.y1), b = mir(cp.x2, cp.y2); cp.x1=a.x;cp.y1=a.y;cp.x2=b.x;cp.y2=b.y; }
  if ('cx' in cp) { const a = mir(cp.cx, cp.cy); cp.cx=a.x;cp.cy=a.y; }
  if ('ox' in cp) { const a = mir(cp.ox, cp.oy); cp.ox=a.x;cp.oy=a.y; }
  if ('x' in cp && !('x1' in cp)) { const a = mir(cp.x, cp.y); cp.x=a.x;cp.y=a.y; }
  if (cp.points) cp.points = cp.points.map(p => mir(p.x, p.y));
  if (cp.mx != null) { const a = mir(cp.mx + cp.cx, cp.my + cp.cy); cp.mx = a.x - cp.cx; cp.my = a.y - cp.cy; }
  return cp;
}

// ─── SCALE ─ merkez + faktör ──────────────────────────────────────
function acadCmdScaleStart() {
  if (!acadState.selection.length) { acadLog('SCALE: Önce nesne seç.', 'cmd-err'); return; }
  acadState.pending = { type: 'scale', step: 0, points: [], sel: [...acadState.selection] };
  acadSetPrompt('SCALE — Referans (merkez) noktası:');
}
function acadScaleEntity(e, cx, cy, f) {
  const cp = JSON.parse(JSON.stringify(e));
  const sc = (x, y) => ({ x: cx + (x - cx) * f, y: cy + (y - cy) * f });
  if ('x1' in cp) { const a = sc(cp.x1, cp.y1), b = sc(cp.x2, cp.y2); cp.x1=a.x;cp.y1=a.y;cp.x2=b.x;cp.y2=b.y; }
  if ('cx' in cp) { const a = sc(cp.cx, cp.cy); cp.cx=a.x;cp.cy=a.y; if ('r' in cp) cp.r *= f; if ('mx' in cp) { cp.mx *= f; cp.my *= f; } }
  if ('ox' in cp) { const a = sc(cp.ox, cp.oy); cp.ox=a.x;cp.oy=a.y; }
  if ('x' in cp && !('x1' in cp)) { const a = sc(cp.x, cp.y); cp.x=a.x;cp.y=a.y; if ('height' in cp) cp.height *= f; }
  if (cp.points) cp.points = cp.points.map(p => sc(p.x, p.y));
  return cp;
}

// ─── BREAK ─ line'ı 2 noktada kes (ortada kalan parça silinir) ─────
function acadCmdBreakStart() {
  acadState.pending = { type: 'break', step: 0, points: [] };
  acadSetPrompt('BREAK — Kesilecek çizgiyi seç:');
}

// ─── LENGTHEN ─ çizgiye delta ekle (DE dE veya uzunluk yaz) ───────
function acadCmdLengthen() {
  if (!acadState.selection.length) { acadLog('LENGTHEN: Önce bir çizgi seç.', 'cmd-err'); return; }
  const s = acadState.selection[0];
  if (s.type !== 'line') { acadLog('LENGTHEN: Sadece çizgi için.', 'cmd-err'); return; }
  const str = prompt('Uzatma miktarı (+/-, örn: 10 ya da -5):', '10');
  const d = parseFloat(str);
  if (isNaN(d)) return;
  const L = scanState.entities.lines[s.index];
  const vx = L.x2 - L.x1, vy = L.y2 - L.y1;
  const len = Math.hypot(vx, vy) || 1;
  acadSnapshot();
  L.x2 += (vx / len) * d; L.y2 += (vy / len) * d;
  acadLog(`LENGTHEN: ${d} birim.`, 'cmd-ok');
  acadRender();
}

// ─── ARRAY ─ rectangular array ────────────────────────────────────
function acadCmdArray() {
  if (!acadState.selection.length) { acadLog('ARRAY: Önce nesne seç.', 'cmd-err'); return; }
  const rows = parseInt(prompt('Satır sayısı:', '2'), 10);
  const cols = parseInt(prompt('Sütun sayısı:', '3'), 10);
  const dy = parseFloat(prompt('Satır aralığı (y):', '50'));
  const dx = parseFloat(prompt('Sütun aralığı (x):', '50'));
  if (!rows || !cols || isNaN(dx) || isNaN(dy)) return;
  acadSnapshot();
  const sel = [...acadState.selection];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      sel.forEach(s => {
        const src = scanState.entities[s.type + 's'][s.index];
        if (!src) return;
        const cp = acadShiftEntity(src, c * dx, r * dy);
        scanState.entities[s.type + 's'].push(cp);
      });
    }
  }
  acadLog(`ARRAY: ${rows}×${cols}=${rows*cols-1} kopya.`, 'cmd-ok');
  acadRender();
}

// ─── SMOOTH ─ backend smooth çağır ────────────────────────────────
async function acadCmdSmooth() {
  if (!scanState.file) { acadLog('SMOOTH: Önce dosya yükleyin.', 'cmd-err'); return; }
  acadLog('SMOOTH: Backend çağrılıyor...', 'cmd-ok');
  try {
    if (typeof scanSmooth === 'function') { await scanSmooth(); acadLog('SMOOTH: Tamamlandı.', 'cmd-ok'); acadFit(); }
    else acadLog('SMOOTH: scanSmooth() bulunamadı.', 'cmd-err');
  } catch (e) { acadLog('SMOOTH hatası: ' + e.message, 'cmd-err'); }
}

// ─── DIVIDE ─ çizgiyi N parçaya böl, noktalar ekle ────────────────
function acadCmdDivide() {
  if (!acadState.selection.length) { acadLog('DIVIDE: Önce bir çizgi/polyline seç.', 'cmd-err'); return; }
  const n = parseInt(prompt('Parça sayısı:', '5'), 10);
  if (!n || n < 2) return;
  const s = acadState.selection[0];
  acadSnapshot();
  if (s.type === 'line') {
    const L = scanState.entities.lines[s.index];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      scanState.entities.points.push({ type:'POINT', x: L.x1 + t*(L.x2-L.x1), y: L.y1 + t*(L.y2-L.y1), layer: acadState.currentLayer });
    }
    acadLog(`DIVIDE: ${n-1} nokta eklendi.`, 'cmd-ok');
    acadRender();
  } else {
    acadLog('DIVIDE: Şu an sadece line destekli.', 'cmd-err');
  }
}

// ─── MEASURE ─ her D mesafede nokta ekle ──────────────────────────
function acadCmdMeasure() {
  if (!acadState.selection.length) { acadLog('MEASURE: Önce bir çizgi seç.', 'cmd-err'); return; }
  const d = parseFloat(prompt('Aralık mesafesi:', '10'));
  if (!d || d <= 0) return;
  const s = acadState.selection[0];
  if (s.type !== 'line') { acadLog('MEASURE: Sadece line için.', 'cmd-err'); return; }
  acadSnapshot();
  const L = scanState.entities.lines[s.index];
  const len = Math.hypot(L.x2-L.x1, L.y2-L.y1);
  const n = Math.floor(len / d);
  for (let i = 1; i <= n; i++) {
    const t = (i * d) / len;
    scanState.entities.points.push({ type:'POINT', x: L.x1 + t*(L.x2-L.x1), y: L.y1 + t*(L.y2-L.y1), layer: acadState.currentLayer });
  }
  acadLog(`MEASURE: ${n} nokta eklendi.`, 'cmd-ok');
  acadRender();
}

// ─── REGEN ─ zorunlu yeniden çizim ────────────────────────────────
function acadCmdRegen() { acadRender(); acadLog('REGEN: Yeniden çizildi.', 'cmd-ok'); }

// ─── PURGE ─ boş (üzerinde nesne olmayan) katmanları sil ──────────
function acadCmdPurge() {
  const used = new Set();
  ['lines','circles','arcs','polylines','rectangles','polygons','dimensions','splines','ellipses','points','texts','xlines','rays','leaders'].forEach(k => {
    (scanState.entities[k] || []).forEach(o => used.add(o.layer || '0'));
  });
  const before = acadState.layers.length;
  acadState.layers = acadState.layers.filter(L => L.name === '0' || used.has(L.name));
  if (!acadState.layers.find(L => L.name === acadState.currentLayer)) acadState.currentLayer = acadState.layers[0].name;
  acadRenderLayers(); acadRender();
  acadLog(`PURGE: ${before - acadState.layers.length} boş katman silindi.`, 'cmd-ok');
}

// ─── DIST ─ 2 nokta arası mesafe ──────────────────────────────────
function acadCmdDist() {
  acadState.pending = { type: 'dist', step: 0, points: [] };
  acadSetPrompt('DIST — Birinci nokta:');
}

// ─── ID ─ bir noktanın koordinatı ─────────────────────────────────
function acadCmdId() {
  acadState.pending = { type: 'id', step: 0, points: [] };
  acadSetPrompt('ID — Nokta seç:');
}

// ─── AREA ─ polygon/rect/polyline alanı ───────────────────────────
function acadCmdArea() {
  if (!acadState.selection.length) { acadLog('AREA: Bir polygon/rectangle/polyline seç.', 'cmd-err'); return; }
  const s = acadState.selection[0];
  let pts = [];
  if (s.type === 'polygon') pts = scanState.entities.polygons[s.index].points || [];
  else if (s.type === 'polyline') pts = scanState.entities.polylines[s.index].points || [];
  else if (s.type === 'rectangle') {
    const r = scanState.entities.rectangles[s.index];
    pts = [{x:r.x1,y:r.y1},{x:r.x2,y:r.y1},{x:r.x2,y:r.y2},{x:r.x1,y:r.y2}];
  } else if (s.type === 'circle') {
    const c = scanState.entities.circles[s.index];
    const area = Math.PI * c.r * c.r;
    acadLog(`AREA: Çember alanı = ${area.toFixed(2)} (r=${c.r.toFixed(2)})`, 'cmd-ok');
    return;
  } else { acadLog('AREA: Bu tip için desteklenmiyor.', 'cmd-err'); return; }
  // Shoelace
  let a = 0, per = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    per += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
  }
  a = Math.abs(a) / 2;
  acadLog(`AREA: Alan=${a.toFixed(2)} · Çevre=${per.toFixed(2)}`, 'cmd-ok');
}

// ─── LIST ─ seçili nesne(ler)'in ayrıntısı ────────────────────────
function acadCmdList() {
  if (!acadState.selection.length) { acadLog('LIST: Önce nesne seç.', 'cmd-err'); return; }
  acadState.selection.forEach(s => {
    const e = scanState.entities[s.type + 's'][s.index];
    if (!e) return;
    acadLog(`${s.type.toUpperCase()}#${s.index} (layer=${e.layer||'0'}): ${JSON.stringify(e)}`, 'cmd-ok');
  });
}

// ─── PROPERTIES ─ basit panel (sadece log şimdilik) ──────────────
function acadCmdProperties() {
  if (!acadState.selection.length) { acadLog('PROPERTIES: Önce nesne seç.', 'cmd-err'); return; }
  acadCmdList();
}

// ─── TEXT / DTEXT / MTEXT ─────────────────────────────────────────
function acadCmdText() {
  acadState.pending = { type: 'text', step: 0, points: [] };
  acadSetPrompt('TEXT — Yerleşim noktası:');
}

// ─── POINT ─ tek nokta yerleştir ─────────────────────────────────
function acadCmdPoint() {
  acadState.pending = { type: 'point', step: 0, points: [] };
  acadSetPrompt('POINT — Nokta yeri (tıkla):');
}

// ─── ELLIPSE ─ merkez + birinci eksen ucu + oran ─────────────────
function acadCmdEllipse() {
  acadState.pending = { type: 'ellipse', step: 0, points: [] };
  acadSetPrompt('ELLIPSE — Merkez noktası:');
}

// ─── XLINE / RAY ─ sonsuz çizgiler ────────────────────────────────
function acadCmdXLine() {
  acadState.pending = { type: 'xline', step: 0, points: [] };
  acadSetPrompt('XLINE — Üzerinden geçecek 1. nokta:');
}
function acadCmdRay() {
  acadState.pending = { type: 'ray', step: 0, points: [] };
  acadSetPrompt('RAY — Başlangıç noktası:');
}

// ─── LEADER ─ ok + çizgi + metin ──────────────────────────────────
function acadCmdLeader() {
  acadState.pending = { type: 'leader', step: 0, points: [] };
  acadSetPrompt('LEADER — Ok ucu noktası:');
}

// ─── DIMRADIUS / DIMDIAMETER ─ çember/yay için ────────────────────
function acadCmdDimRadius(kind) {
  // kind: 'radius' | 'diameter' (eski kısa: 'rad' | 'dia' de kabul)
  const isRadius = (kind === 'radius' || kind === 'rad');
  const label = isRadius ? 'DIMRADIUS' : 'DIMDIAMETER';
  if (!acadState.selection.length) { acadLog(`${label}: Çember veya yay seç.`, 'cmd-err'); return; }
  const s = acadState.selection[0];
  if (s.type !== 'circle' && s.type !== 'arc') { acadLog(`${label}: Sadece çember/yay.`, 'cmd-err'); return; }
  const e = scanState.entities[s.type + 's'][s.index];
  const text = (isRadius ? 'R' : 'Ø') + ' ' + (isRadius ? e.r : e.r * 2).toFixed(2);
  // Metni çemberin yanına yerleştir
  const ang = 30 * Math.PI / 180;
  const lx = e.cx + Math.cos(ang) * e.r * 1.3, ly = e.cy + Math.sin(ang) * e.r * 1.3;
  acadSnapshot();
  scanState.entities.leaders.push({
    type: 'LEADER',
    x1: e.cx + Math.cos(ang) * e.r, y1: e.cy + Math.sin(ang) * e.r,
    x2: lx, y2: ly,
    x3: lx + 20, y3: ly,
    text, layer: acadState.currentLayer,
  });
  acadLog(`${label}: ${text}`, 'cmd-ok');
  acadRender();
}

// ─── DIMANGULAR ─ iki çizgi arası açı ────────────────────────────
function acadCmdDimAngular() {
  const sel = acadState.selection.filter(s => s.type === 'line');
  if (sel.length < 2) { acadLog('DAN: İki çizgi seç.', 'cmd-err'); return; }
  const L1 = scanState.entities.lines[sel[0].index];
  const L2 = scanState.entities.lines[sel[1].index];
  const v1 = { x: L1.x2 - L1.x1, y: L1.y2 - L1.y1 };
  const v2 = { x: L2.x2 - L2.x1, y: L2.y2 - L2.y1 };
  const cos = (v1.x*v2.x + v1.y*v2.y) / (Math.hypot(v1.x,v1.y) * Math.hypot(v2.x,v2.y));
  const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  const ip = acadInfiniteLineIntersect(L1, L2);
  acadSnapshot();
  scanState.entities.leaders.push({
    type: 'LEADER',
    x1: ip ? ip.x : (L1.x1+L2.x1)/2, y1: ip ? ip.y : (L1.y1+L2.y1)/2,
    x2: (ip ? ip.x : L1.x1) + 40, y2: (ip ? ip.y : L1.y1) + 40,
    x3: (ip ? ip.x : L1.x1) + 60, y3: (ip ? ip.y : L1.y1) + 40,
    text: `${deg.toFixed(2)}°`, layer: acadState.currentLayer,
  });
  acadLog(`DAN: ${deg.toFixed(2)}°`, 'cmd-ok');
  acadRender();
}

// ─── MATCHPROP ─ katman/renk özelliklerini bir nesneden diğerine kopyala ───
function acadCmdMatchprop() {
  if (acadState.selection.length < 2) { acadLog('MATCHPROP: En az 2 nesne seçin (ilki kaynak).', 'cmd-err'); return; }
  const source = acadState.selection[0];
  const src = scanState.entities[source.type + 's'][source.index];
  acadSnapshot();
  acadState.selection.slice(1).forEach(s => {
    const t = scanState.entities[s.type + 's'][s.index];
    if (t) t.layer = src.layer || '0';
  });
  acadLog(`MATCHPROP: Katman=${src.layer || '0'} kopyalandı.`, 'cmd-ok');
  acadRender();
}

// ═══════════════ Yeni tool handler'ları (click akışları) ════════════

// Edit komut akışları için acadHandleToolClick'e ek dispatcher
function acadHandleExtClick(pt, ev) {
  const p = acadState.pending;
  if (!p) return false;

  // FILLET — 2 çizgi seç
  if (p.type === 'fillet' || p.type === 'chamfer') {
    const hit = acadHitTest(pt, ev);
    if (!hit || hit.type !== 'line') { acadLog(`${p.type.toUpperCase()}: Bir çizgiye tıkla.`, 'cmd-err'); return true; }
    p.lines.push(hit);
    if (p.lines.length === 1) {
      acadSetPrompt(`${p.type.toUpperCase()} — İkinci çizgiyi seç:`);
    } else {
      acadSnapshot();
      const L1 = scanState.entities.lines[p.lines[0].index];
      const L2 = scanState.entities.lines[p.lines[1].index];
      const ok = p.type === 'fillet'
        ? acadFilletApply(L1, L2, p.radius)
        : acadChamferApply(L1, L2, p.dist);
      if (ok) acadLog(`${p.type.toUpperCase()}: Uygulandı.`, 'cmd-ok');
      acadState.pending = null;
      acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
      acadRender();
    }
    return true;
  }

  // MIRROR — 2 nokta
  if (p.type === 'mirror') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('MIRROR — 2. nokta:');
      p.preview = () => acadPreviewTransform(p.sel, e => acadMirrorEntity(e, p.points[0], acadState.mouseWorld));
    } else {
      acadSnapshot();
      const keepOrig = !confirm('Orijinali sil? (Tamam=sil, İptal=koru)');
      p.sel.forEach(s => {
        const arr = scanState.entities[s.type + 's'];
        if (arr && arr[s.index]) {
          const m = acadMirrorEntity(arr[s.index], p.points[0], p.points[1]);
          if (keepOrig) arr.push(m);
          else Object.assign(arr[s.index], m);
        }
      });
      acadLog('MIRROR: Tamamlandı.', 'cmd-ok');
      acadState.pending = null; acadState.selection = [];
      acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
      acadRender();
    }
    return true;
  }

  // SCALE — merkez + faktör noktası (ilk 2 nokta arası = referans uzunluk, 3. nokta = yeni uzunluk)
  if (p.type === 'scale') {
    p.points.push(pt);
    if (p.points.length === 1) { acadSetPrompt('SCALE — Referans uzunluk 1. nokta (komut satırına faktör de yazabilirsin):'); return true; }
    if (p.points.length === 2) {
      acadSetPrompt('SCALE — Yeni uzunluk noktası:');
      p.preview = () => {
        const refLen = Math.hypot(p.points[1].x - p.points[0].x, p.points[1].y - p.points[0].y) || 1;
        const newLen = Math.hypot(acadState.mouseWorld.x - p.points[0].x, acadState.mouseWorld.y - p.points[0].y);
        const f = newLen / refLen;
        return acadPreviewTransform(p.sel, e => acadScaleEntity(e, p.points[0].x, p.points[0].y, f));
      };
      return true;
    }
    const refLen = Math.hypot(p.points[1].x - p.points[0].x, p.points[1].y - p.points[0].y) || 1;
    const newLen = Math.hypot(p.points[2].x - p.points[0].x, p.points[2].y - p.points[0].y);
    const f = newLen / refLen;
    acadSnapshot();
    p.sel.forEach(s => {
      const arr = scanState.entities[s.type + 's'];
      if (arr && arr[s.index]) Object.assign(arr[s.index], acadScaleEntity(arr[s.index], p.points[0].x, p.points[0].y, f));
    });
    acadLog(`SCALE: Faktör=${f.toFixed(3)}`, 'cmd-ok');
    acadState.pending = null; acadState.selection = [];
    acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return true;
  }

  // BREAK — line + 2 nokta
  if (p.type === 'break') {
    if (!p.picked) {
      const hit = acadHitTest(pt, ev);
      if (!hit || hit.type !== 'line') { acadLog('BREAK: Bir çizgiye tıkla.', 'cmd-err'); return true; }
      p.picked = hit;
      acadSetPrompt('BREAK — 1. kesim noktası:');
      return true;
    }
    p.points.push(pt);
    if (p.points.length === 1) { acadSetPrompt('BREAK — 2. kesim noktası:'); return true; }
    // 2 nokta alındı
    const L = scanState.entities.lines[p.picked.index];
    // L üzerindeki t parametreleri
    const proj = (pt) => {
      const vx = L.x2 - L.x1, vy = L.y2 - L.y1, ll = vx*vx + vy*vy || 1;
      return ((pt.x - L.x1) * vx + (pt.y - L.y1) * vy) / ll;
    };
    const t1 = Math.min(proj(p.points[0]), proj(p.points[1]));
    const t2 = Math.max(proj(p.points[0]), proj(p.points[1]));
    const px = (t) => ({ x: L.x1 + t * (L.x2 - L.x1), y: L.y1 + t * (L.y2 - L.y1) });
    acadSnapshot();
    const p1 = px(t1), p2 = px(t2);
    const orig = { ...L };
    // L'yi 1. parça yap
    L.x1 = orig.x1; L.y1 = orig.y1; L.x2 = p1.x; L.y2 = p1.y;
    // 2. parçayı ekle
    scanState.entities.lines.push({ type:'LINE', x1: p2.x, y1: p2.y, x2: orig.x2, y2: orig.y2, layer: orig.layer });
    acadLog('BREAK: Çizgi ikiye bölündü.', 'cmd-ok');
    acadState.pending = null;
    acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return true;
  }

  // DIST — 2 nokta
  if (p.type === 'dist') {
    p.points.push(pt);
    if (p.points.length === 1) { acadSetPrompt('DIST — 2. nokta:'); return true; }
    const d = Math.hypot(p.points[1].x - p.points[0].x, p.points[1].y - p.points[0].y);
    const ang = Math.atan2(p.points[1].y - p.points[0].y, p.points[1].x - p.points[0].x) * 180 / Math.PI;
    acadLog(`DIST: ${d.toFixed(2)} @ ${ang.toFixed(2)}°  (dx=${(p.points[1].x-p.points[0].x).toFixed(2)}, dy=${(p.points[1].y-p.points[0].y).toFixed(2)})`, 'cmd-ok');
    acadState.pending = null; acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    return true;
  }

  // ID — 1 nokta
  if (p.type === 'id') {
    acadLog(`ID: (${pt.x.toFixed(4)}, ${pt.y.toFixed(4)})`, 'cmd-ok');
    acadState.pending = null; acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    return true;
  }

  // TEXT — nokta + yazı
  if (p.type === 'text') {
    const txt = prompt('Metin:');
    if (txt == null || txt === '') { acadCancel(); return true; }
    const h = parseFloat(prompt('Yükseklik:', '10')) || 10;
    acadSnapshot();
    scanState.entities.texts.push({ type:'TEXT', x: pt.x, y: pt.y, text: txt, height: h, rotation: 0, layer: acadState.currentLayer });
    acadLog(`TEXT eklendi: "${txt}"`, 'cmd-ok');
    acadState.pending = null; acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return true;
  }

  // POINT
  if (p.type === 'point') {
    acadSnapshot();
    scanState.entities.points.push({ type:'POINT', x: pt.x, y: pt.y, layer: acadState.currentLayer });
    acadLog(`POINT: (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`, 'cmd-ok');
    acadRender();
    return true; // sürekli mod
  }

  // ELLIPSE — merkez + 1. eksen ucu + oran (komut satırı veya fare)
  if (p.type === 'ellipse') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt('ELLIPSE — Eksen ucu (1. yarıçap):');
      p.preview = () => {
        const c = acadW2S(p.points[0].x, p.points[0].y);
        const m = acadState.mouseWorld;
        const rx = Math.hypot(m.x - p.points[0].x, m.y - p.points[0].y) * acadState.zoom;
        const rot = Math.atan2(-(m.y - p.points[0].y), m.x - p.points[0].x) * 180 / Math.PI;
        return `<ellipse cx="${c.x}" cy="${c.y}" rx="${rx}" ry="${rx*0.5}" fill="none" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3" transform="rotate(${rot} ${c.x} ${c.y})"/>`;
      };
      return true;
    }
    if (p.points.length === 2) {
      acadSetPrompt('ELLIPSE — İkinci yarıçap uzunluğu:');
      p.preview = () => {
        const c = acadW2S(p.points[0].x, p.points[0].y);
        const mx = p.points[1].x - p.points[0].x, my = p.points[1].y - p.points[0].y;
        const R = Math.hypot(mx, my);
        const m2 = acadState.mouseWorld;
        const ratio = Math.hypot(m2.x - p.points[0].x, m2.y - p.points[0].y) / (R || 1);
        const rx = R * acadState.zoom;
        const rot = Math.atan2(-my, mx) * 180 / Math.PI;
        return `<ellipse cx="${c.x}" cy="${c.y}" rx="${rx}" ry="${rx*ratio}" fill="none" stroke="#ffb400" stroke-width="1" stroke-dasharray="5 3" transform="rotate(${rot} ${c.x} ${c.y})"/>`;
      };
      return true;
    }
    acadSnapshot();
    const mx = p.points[1].x - p.points[0].x, my = p.points[1].y - p.points[0].y;
    const R = Math.hypot(mx, my) || 1;
    const ratio = Math.min(1, Math.hypot(p.points[2].x - p.points[0].x, p.points[2].y - p.points[0].y) / R);
    scanState.entities.ellipses.push({
      type:'ELLIPSE', cx: p.points[0].x, cy: p.points[0].y, mx, my, ratio, layer: acadState.currentLayer,
    });
    acadLog(`ELLIPSE: R=${R.toFixed(2)}, ratio=${ratio.toFixed(3)}`, 'cmd-ok');
    acadState.pending = null; acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return true;
  }

  // XLINE — 2 nokta (birinci + açı belirleyen ikinci)
  if (p.type === 'xline' || p.type === 'ray') {
    p.points.push(pt);
    if (p.points.length === 1) {
      acadSetPrompt(`${p.type.toUpperCase()} — Yön noktası:`);
      p.preview = () => {
        const ang = Math.atan2(acadState.mouseWorld.y - p.points[0].y, acadState.mouseWorld.x - p.points[0].x) * 180 / Math.PI;
        return acadRenderEntity({ x: p.points[0].x, y: p.points[0].y, angle: ang }, p.type, -1, '#ffb400', 1);
      };
      return true;
    }
    const ang = Math.atan2(p.points[1].y - p.points[0].y, p.points[1].x - p.points[0].x) * 180 / Math.PI;
    acadSnapshot();
    const key = p.type === 'xline' ? 'xlines' : 'rays';
    scanState.entities[key].push({ type: p.type.toUpperCase(), x: p.points[0].x, y: p.points[0].y, angle: ang, layer: acadState.currentLayer });
    acadLog(`${p.type.toUpperCase()}: açı=${ang.toFixed(2)}°`, 'cmd-ok');
    acadState.pending = null; acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return true;
  }

  // LEADER — 3 nokta + text
  if (p.type === 'leader') {
    p.points.push(pt);
    if (p.points.length === 1) { acadSetPrompt('LEADER — Kırılma noktası:'); return true; }
    if (p.points.length === 2) { acadSetPrompt('LEADER — Metin noktası:'); return true; }
    const txt = prompt('Leader metni:', '');
    if (txt == null) { acadCancel(); return true; }
    acadSnapshot();
    scanState.entities.leaders.push({
      type:'LEADER',
      x1: p.points[0].x, y1: p.points[0].y,
      x2: p.points[1].x, y2: p.points[1].y,
      x3: p.points[2].x, y3: p.points[2].y,
      text: txt, layer: acadState.currentLayer,
    });
    acadLog('LEADER eklendi.', 'cmd-ok');
    acadState.pending = null; acadSetPrompt('Komut:'); acadState.tool = 'select'; acadHighlightToolBtn('select');
    acadRender();
    return true;
  }

  return false;
}

