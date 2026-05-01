// ── Görsel Editör ─────────────────────────────────────────────────────────────
const ied = {
  hasImage: false, width: 0, height: 0,
  workCanvas: null, workCtx: null,
  history: [], historyIdx: -1, MAX_HISTORY: 25,
  adj: { brightness:0, contrast:0, saturation:0, sharpness:0, blur:0,
         threshold:128, thresholdEnabled:false, invert:false, grayscale:false, red:0, green:0, blue:0 },
  adjDirty: false,
  zoom: 1, panX: 0, panY: 0,
  tool: 'select', brushSize: 20, brushColor: '#ffffff', magicTolerance: 40,
  isDrawing: false, isPanning: false, spaceDown: false,
  lastPos: null, panAnchor: null,
  cropStart: null, cropRect: null,
  initialized: false,
};

// ── Accessors ─────────────────────────────────────────────────────────────────
function iedC()    { return document.getElementById('iedCanvas'); }
function iedOvr()  { return document.getElementById('iedOverlay'); }
function iedWrap() { return document.getElementById('iedCanvasWrap'); }
function iedCX()   { return iedC().getContext('2d', { willReadFrequently: true }); }

// ── Init (called once when page first activates) ──────────────────────────────
function initImageEditor() {
  if (ied.initialized) return;
  ied.initialized = true;

  ied.workCanvas = document.createElement('canvas');
  ied.workCtx    = ied.workCanvas.getContext('2d', { willReadFrequently: true });

  const cv  = iedC();
  const ovr = iedOvr();
  const wp  = iedWrap();

  cv.addEventListener('mousedown',  iedMouseDown);
  cv.addEventListener('mousemove',  iedMouseMove);
  cv.addEventListener('mouseup',    iedMouseUp);
  cv.addEventListener('mouseleave', iedMouseLeave);
  cv.addEventListener('wheel',      iedWheel, { passive: false });
  cv.addEventListener('touchstart', iedTouchStart, { passive: false });
  cv.addEventListener('touchmove',  iedTouchMove,  { passive: false });
  cv.addEventListener('touchend',   iedTouchEnd);

  wp.addEventListener('mousedown', iedWrapDown);
  wp.addEventListener('mousemove', iedWrapMove);
  wp.addEventListener('mouseup',   iedWrapUp);

  document.addEventListener('keydown', iedKeydown);
  document.addEventListener('keyup',   iedKeyup);

  const dz = document.getElementById('iedDropzone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) iedLoadFile(e.dataTransfer.files[0]); });
  dz.addEventListener('click', () => document.getElementById('iedFileInput').click());
}

// ── File loading ──────────────────────────────────────────────────────────────
function iedOpenFile() { document.getElementById('iedFileInput').click(); }

function iedFileSelected(e) {
  if (e.target.files[0]) iedLoadFile(e.target.files[0]);
  e.target.value = '';
}

function iedLoadFile(file) {
  if (!file || !file.type.startsWith('image/')) { iedToast('Sadece görsel dosyaları desteklenir.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height;
      ied.width = w; ied.height = h;

      [iedC(), iedOvr(), ied.workCanvas].forEach(c => { c.width = w; c.height = h; });

      ied.workCtx.drawImage(img, 0, 0);
      iedCX().drawImage(img, 0, 0);

      ied.history = []; ied.historyIdx = -1;
      ied.hasImage = true; ied.adjDirty = false;
      iedResetAdjSliders();

      iedPushHistory('Yükle');
      iedUpdateTransform();
      iedZoomFit();

      document.getElementById('iedDropzone').style.display = 'none';
      iedC().style.display   = 'block';
      iedOvr().style.display = 'block';

      document.getElementById('iedStatusSize').textContent = `${w} × ${h}`;
      iedToast('Görsel yüklendi.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Render ────────────────────────────────────────────────────────────────────
function iedRender() {
  if (!ied.hasImage) return;
  const ctx = iedCX();
  ctx.clearRect(0, 0, ied.width, ied.height);
  ctx.drawImage(ied.workCanvas, 0, 0);

  if (ied.adjDirty) {
    const id = ctx.getImageData(0, 0, ied.width, ied.height);
    iedApplyAdjToData(id.data, ied.width, ied.height, ied.adj);
    ctx.putImageData(id, 0, 0);
  }
}

function iedRenderOverlay() {
  const ctx = iedOvr().getContext('2d');
  ctx.clearRect(0, 0, ied.width, ied.height);
  if (ied.tool === 'crop' && ied.cropRect) {
    const { x, y, w, h } = ied.cropRect;
    const lw = 1.5 / ied.zoom;
    ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = lw; ctx.setLineDash([6/ied.zoom, 3/ied.zoom]);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(14,165,233,0.07)'; ctx.fillRect(x, y, w, h);
    // thirds
    ctx.strokeStyle = 'rgba(14,165,233,0.35)'; ctx.lineWidth = lw * 0.5;
    ctx.beginPath();
    [x+w/3, x+2*w/3].forEach(px => { ctx.moveTo(px,y); ctx.lineTo(px,y+h); });
    [y+h/3, y+2*h/3].forEach(py => { ctx.moveTo(x,py); ctx.lineTo(x+w,py); });
    ctx.stroke();
    // handles
    const hs = 5/ied.zoom; ctx.fillStyle = '#0ea5e9';
    [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([hx,hy]) => ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs));
    // size label
    ctx.font = `${12/ied.zoom}px monospace`; ctx.fillStyle = '#0ea5e9';
    ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x+4/ied.zoom, y-4/ied.zoom);
  }
}

// ── Transform ─────────────────────────────────────────────────────────────────
function iedUpdateTransform() {
  const t = `translate(${ied.panX}px,${ied.panY}px) scale(${ied.zoom})`;
  iedC().style.transform   = t; iedC().style.transformOrigin   = '0 0';
  iedOvr().style.transform = t; iedOvr().style.transformOrigin = '0 0';
  const z = Math.round(ied.zoom * 100) + '%';
  document.getElementById('iedZoomVal').textContent    = z;
  document.getElementById('iedStatusZoom').textContent = 'Zoom: ' + z;
}

function iedZoomFit() {
  if (!ied.hasImage) return;
  const wp = iedWrap();
  const pw = wp.clientWidth - 60, ph = wp.clientHeight - 60;
  ied.zoom = Math.min(pw / ied.width, ph / ied.height, 1);
  ied.panX = (wp.clientWidth  - ied.width  * ied.zoom) / 2;
  ied.panY = (wp.clientHeight - ied.height * ied.zoom) / 2;
  iedUpdateTransform();
}

// ── Zoom wheel (cursor-centered) ──────────────────────────────────────────────
function iedWheel(e) {
  e.preventDefault();
  const wp   = iedWrap();
  const rect = wp.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;
  const factor   = e.deltaY < 0 ? 1.15 : 1/1.15;
  const newZoom  = Math.min(20, Math.max(0.02, ied.zoom * factor));
  const ratio    = newZoom / ied.zoom;
  ied.panX = mx - ratio * (mx - ied.panX);
  ied.panY = my - ratio * (my - ied.panY);
  ied.zoom = newZoom;
  iedUpdateTransform();
}

// ── Coord helpers ─────────────────────────────────────────────────────────────
function iedToImage(clientX, clientY) {
  const rect = iedWrap().getBoundingClientRect();
  return {
    x: Math.round((clientX - rect.left - ied.panX) / ied.zoom),
    y: Math.round((clientY - rect.top  - ied.panY) / ied.zoom),
  };
}

// ── Mouse events ──────────────────────────────────────────────────────────────
function iedMouseDown(e) {
  if (!ied.hasImage) return;
  e.preventDefault();
  if (e.button === 1 || (e.button === 0 && ied.spaceDown)) {
    ied.isPanning   = true;
    ied.panAnchor   = { x: e.clientX - ied.panX, y: e.clientY - ied.panY };
    iedC().style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  const pos = iedToImage(e.clientX, e.clientY);
  switch (ied.tool) {
    case 'brush': case 'eraser':
      ied.isDrawing = true; ied.lastPos = pos;
      iedBrushAt(pos.x, pos.y); break;
    case 'magic':   iedMagicWand(pos.x, pos.y); break;
    case 'eyedrop': iedEyedrop(pos.x, pos.y); break;
    case 'crop':
      ied.isDrawing = true; ied.cropStart = pos; ied.cropRect = null; break;
  }
}

function iedMouseMove(e) {
  if (!ied.hasImage) return;
  const pos = iedToImage(e.clientX, e.clientY);
  const inBounds = pos.x >= 0 && pos.x < ied.width && pos.y >= 0 && pos.y < ied.height;
  document.getElementById('iedStatusPos').textContent = inBounds
    ? `X: ${pos.x}  Y: ${pos.y}`
    : 'X: —  Y: —';

  if (ied.isPanning) {
    ied.panX = e.clientX - ied.panAnchor.x;
    ied.panY = e.clientY - ied.panAnchor.y;
    iedUpdateTransform(); return;
  }
  if (!ied.isDrawing) return;
  switch (ied.tool) {
    case 'brush': case 'eraser':
      if (ied.lastPos) iedBrushLine(ied.lastPos, pos);
      ied.lastPos = pos; break;
    case 'crop':
      if (ied.cropStart) {
        ied.cropRect = {
          x: Math.max(0, Math.min(ied.cropStart.x, pos.x)),
          y: Math.max(0, Math.min(ied.cropStart.y, pos.y)),
          w: Math.min(ied.width,  Math.abs(pos.x - ied.cropStart.x)),
          h: Math.min(ied.height, Math.abs(pos.y - ied.cropStart.y)),
        };
        iedRenderOverlay();
      }
      break;
  }
}

function iedMouseUp(e) {
  if (ied.isPanning) { ied.isPanning = false; iedC().style.cursor = iedToolCursor(); return; }
  if (!ied.isDrawing) return;
  ied.isDrawing = false;
  switch (ied.tool) {
    case 'brush': case 'eraser':
      ied.lastPos = null;
      iedCommit('Fırça');
      break;
    case 'crop':
      if (ied.cropRect && ied.cropRect.w > 4 && ied.cropRect.h > 4) iedApplyCrop();
      ied.cropStart = null; ied.cropRect = null;
      iedRenderOverlay(); break;
  }
}

function iedMouseLeave() { if (ied.isDrawing && (ied.tool==='brush'||ied.tool==='eraser')) ied.lastPos = null; }

// ── Wrap pan (click on empty area around canvas) ──────────────────────────────
function iedWrapDown(e) {
  if (e.target !== iedWrap() && e.target !== iedOvr() && e.button !== 1) return;
  ied.isPanning   = true;
  ied.panAnchor   = { x: e.clientX - ied.panX, y: e.clientY - ied.panY };
}
function iedWrapMove(e) {
  if (!ied.isPanning) return;
  ied.panX = e.clientX - ied.panAnchor.x;
  ied.panY = e.clientY - ied.panAnchor.y;
  iedUpdateTransform();
}
function iedWrapUp() { ied.isPanning = false; }

// ── Touch ─────────────────────────────────────────────────────────────────────
let _iedTD = null, _iedTZ = 1, _iedTP = null;
function iedTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 2) {
    const t = e.touches;
    _iedTD = Math.hypot(t[1].clientX-t[0].clientX, t[1].clientY-t[0].clientY);
    _iedTZ = ied.zoom; _iedTP = { x: ied.panX, y: ied.panY }; return;
  }
  if (e.touches.length === 1) iedMouseDown({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, button: 0, preventDefault:()=>{} });
}
function iedTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 2 && _iedTD) {
    const t = e.touches;
    ied.zoom = Math.min(20, Math.max(0.02, _iedTZ * Math.hypot(t[1].clientX-t[0].clientX, t[1].clientY-t[0].clientY) / _iedTD));
    iedUpdateTransform(); return;
  }
  if (e.touches.length === 1) iedMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
}
function iedTouchEnd() { _iedTD = null; iedMouseUp({}); }

// ── Keyboard ──────────────────────────────────────────────────────────────────
function iedKeydown(e) {
  const pg = document.getElementById('page-image-editor');
  if (!pg || !pg.classList.contains('active')) return;
  if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); iedUndo(); return; }
  if ((e.ctrlKey||e.metaKey) && (e.key==='y'||e.key==='Z')) { e.preventDefault(); iedRedo(); return; }
  if (e.key===' ' && !e.target.closest('input,textarea,select,button')) {
    e.preventDefault(); ied.spaceDown = true; iedC().style.cursor = 'grab'; return;
  }
  if (e.target.closest('input,textarea,select')) return;
  const toolKeys = { b:'brush', e:'eraser', m:'magic', c:'crop', s:'select', d:'eyedrop' };
  if (toolKeys[e.key.toLowerCase()]) { iedSetTool(toolKeys[e.key.toLowerCase()]); return; }
  if (e.key==='+' || e.key==='=') { ied.zoom = Math.min(20, ied.zoom*1.2); iedUpdateTransform(); }
  if (e.key==='-')                  { ied.zoom = Math.max(0.02, ied.zoom/1.2); iedUpdateTransform(); }
  if (e.key==='0')                  iedZoomFit();
  if (e.key==='Delete' || e.key==='Backspace') {
    // Fill selection with white if brush tool active
  }
}
function iedKeyup(e) {
  if (e.key===' ') { ied.spaceDown = false; iedC().style.cursor = iedToolCursor(); }
}

// ── Brush ─────────────────────────────────────────────────────────────────────
function iedBrushAt(x, y) {
  const ctx   = iedCX();
  const color = ied.tool === 'eraser' ? '#000000' : ied.brushColor;
  ctx.beginPath();
  ctx.arc(x, y, ied.brushSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function iedBrushLine(from, to) {
  const ctx   = iedCX();
  const color = ied.tool === 'eraser' ? '#000000' : ied.brushColor;
  const dist  = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, ied.brushSize * 0.15)));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ctx.beginPath();
    ctx.arc(from.x + (to.x-from.x)*t, from.y + (to.y-from.y)*t, ied.brushSize/2, 0, Math.PI*2);
    ctx.fill();
  }
}

// ── Magic Wand (flood fill) ───────────────────────────────────────────────────
function iedMagicWand(sx, sy) {
  if (sx < 0 || sy < 0 || sx >= ied.width || sy >= ied.height) return;
  const ctx  = iedCX();
  const id   = ctx.getImageData(0, 0, ied.width, ied.height);
  const data = id.data;
  const w    = ied.width, h = ied.height;
  const tol  = ied.magicTolerance;
  const [fr, fg, fb] = iedHexRgb(ied.brushColor);

  const si = (sy * w + sx) * 4;
  const sr = data[si], sg = data[si+1], sb = data[si+2];

  const visited = new Uint8Array(w * h);
  const stack   = [sy * w + sx];
  visited[sy * w + sx] = 1;

  while (stack.length) {
    const idx = stack.pop();
    const i   = idx * 4;
    const dr  = data[i]   - sr;
    const dg  = data[i+1] - sg;
    const db  = data[i+2] - sb;
    if (Math.sqrt(dr*dr + dg*dg + db*db) > tol * 2.21) continue;
    data[i] = fr; data[i+1] = fg; data[i+2] = fb;
    const x = idx % w, y = Math.floor(idx / w);
    if (x > 0   && !visited[idx-1]) { visited[idx-1] = 1; stack.push(idx-1); }
    if (x < w-1 && !visited[idx+1]) { visited[idx+1] = 1; stack.push(idx+1); }
    if (y > 0   && !visited[idx-w]) { visited[idx-w] = 1; stack.push(idx-w); }
    if (y < h-1 && !visited[idx+w]) { visited[idx+w] = 1; stack.push(idx+w); }
  }
  ctx.putImageData(id, 0, 0);
  iedCommit('Sihirli Değnek');
}

function iedHexRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

// ── Eyedropper ────────────────────────────────────────────────────────────────
function iedEyedrop(x, y) {
  if (x < 0 || y < 0 || x >= ied.width || y >= ied.height) return;
  const d = iedCX().getImageData(x, y, 1, 1).data;
  const hex = '#' + [d[0],d[1],d[2]].map(v => v.toString(16).padStart(2,'0')).join('');
  ied.brushColor = hex;
  document.getElementById('iedBrushColor').value = hex;
  iedToast(`Renk: ${hex}`);
}

// ── Crop ──────────────────────────────────────────────────────────────────────
function iedApplyCrop() {
  const { x, y, w, h } = ied.cropRect;
  if (w < 2 || h < 2) return;
  const id = iedCX().getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h));

  [iedC(), iedOvr(), ied.workCanvas].forEach(c => { c.width = Math.round(w); c.height = Math.round(h); });
  ied.width = Math.round(w); ied.height = Math.round(h);

  iedCX().putImageData(id, 0, 0);
  ied.workCtx.putImageData(id, 0, 0);
  document.getElementById('iedStatusSize').textContent = `${ied.width} × ${ied.height}`;
  iedPushHistory('Kırp');
  iedZoomFit();
  iedToast(`Kırpıldı: ${ied.width} × ${ied.height}`);
}

// ── Rotate / Flip ─────────────────────────────────────────────────────────────
function iedRotate(deg) {
  if (!ied.hasImage) return;
  const tmp = document.createElement('canvas');
  tmp.width  = Math.abs(deg) === 90 ? ied.height : ied.width;
  tmp.height = Math.abs(deg) === 90 ? ied.width  : ied.height;
  const tc = tmp.getContext('2d');
  tc.translate(tmp.width/2, tmp.height/2);
  tc.rotate(deg * Math.PI/180);
  tc.drawImage(iedC(), -ied.width/2, -ied.height/2);

  ied.width = tmp.width; ied.height = tmp.height;
  [iedC(), iedOvr(), ied.workCanvas].forEach(c => { c.width = tmp.width; c.height = tmp.height; });
  iedCX().drawImage(tmp, 0, 0);
  ied.workCtx.drawImage(tmp, 0, 0);
  document.getElementById('iedStatusSize').textContent = `${ied.width} × ${ied.height}`;
  iedPushHistory(deg > 0 ? 'Döndür →' : 'Döndür ←');
  iedZoomFit();
}

function iedFlip(dir) {
  if (!ied.hasImage) return;
  const tmp = document.createElement('canvas');
  tmp.width = ied.width; tmp.height = ied.height;
  const tc = tmp.getContext('2d');
  tc.translate(dir==='h' ? ied.width : 0, dir==='v' ? ied.height : 0);
  tc.scale(dir==='h' ? -1 : 1, dir==='v' ? -1 : 1);
  tc.drawImage(iedC(), 0, 0);
  iedCX().clearRect(0, 0, ied.width, ied.height);
  iedCX().drawImage(tmp, 0, 0);
  ied.workCtx.clearRect(0, 0, ied.width, ied.height);
  ied.workCtx.drawImage(tmp, 0, 0);
  iedCommit(dir==='h' ? 'Yatay Çevir' : 'Dikey Çevir');
}

// ── Pixel operations ──────────────────────────────────────────────────────────
function iedApplyAdjToData(data, w, h, adj) {
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;

  if (adj.grayscale || adj.thresholdEnabled) {
    for (let i = 0; i < data.length; i += 4) {
      const lum = (0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]) | 0;
      data[i] = data[i+1] = data[i+2] = lum;
    }
  }

  if (adj.blur > 0) {
    const r = Math.max(1, Math.round(adj.blur));
    iedBoxBlur(data, w, h, r);
    if (r > 1) iedBoxBlur(data, w, h, r);
  }

  if (adj.brightness !== 0 || adj.contrast !== 0) {
    const bf = adj.brightness * 2.55;
    const cf = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
    for (let i = 0; i < data.length; i += 4) {
      data[i]   = cl(cf * (data[i]   - 128) + 128 + bf);
      data[i+1] = cl(cf * (data[i+1] - 128) + 128 + bf);
      data[i+2] = cl(cf * (data[i+2] - 128) + 128 + bf);
    }
  }

  if (adj.saturation !== 0) {
    const sf = (adj.saturation + 100) / 100;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      data[i]   = cl(lum + sf * (data[i]   - lum));
      data[i+1] = cl(lum + sf * (data[i+1] - lum));
      data[i+2] = cl(lum + sf * (data[i+2] - lum));
    }
  }

  if (adj.red !== 0 || adj.green !== 0 || adj.blue !== 0) {
    const rf = adj.red * 1.28, gf = adj.green * 1.28, bf = adj.blue * 1.28;
    for (let i = 0; i < data.length; i += 4) {
      data[i]   = cl(data[i]   + rf);
      data[i+1] = cl(data[i+1] + gf);
      data[i+2] = cl(data[i+2] + bf);
    }
  }

  if (adj.sharpness > 0) {
    const blurred = new Uint8ClampedArray(data);
    iedBoxBlur(blurred, w, h, 1);
    const amt = adj.sharpness / 1.5;
    for (let i = 0; i < data.length; i += 4) {
      data[i]   = cl(data[i]   + amt * (data[i]   - blurred[i]));
      data[i+1] = cl(data[i+1] + amt * (data[i+1] - blurred[i+1]));
      data[i+2] = cl(data[i+2] + amt * (data[i+2] - blurred[i+2]));
    }
  }

  if (adj.thresholdEnabled) {
    const t = adj.threshold;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] >= t ? 255 : 0;
      data[i] = data[i+1] = data[i+2] = v;
    }
  }

  if (adj.invert) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255-data[i]; data[i+1] = 255-data[i+1]; data[i+2] = 255-data[i+2];
    }
  }
}

function iedBoxBlur(data, w, h, r) {
  const tmp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rr=0,gg=0,bb=0,cnt=0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.min(w-1, Math.max(0, x+dx));
        const i  = (y*w+nx)*4;
        rr += data[i]; gg += data[i+1]; bb += data[i+2]; cnt++;
      }
      const i = (y*w+x)*4;
      tmp[i]=rr/cnt|0; tmp[i+1]=gg/cnt|0; tmp[i+2]=bb/cnt|0; tmp[i+3]=data[i+3];
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let rr=0,gg=0,bb=0,cnt=0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.min(h-1, Math.max(0, y+dy));
        const i  = (ny*w+x)*4;
        rr += tmp[i]; gg += tmp[i+1]; bb += tmp[i+2]; cnt++;
      }
      const i = (y*w+x)*4;
      data[i]=rr/cnt|0; data[i+1]=gg/cnt|0; data[i+2]=bb/cnt|0;
    }
  }
}

// ── Adjustment UI ─────────────────────────────────────────────────────────────
let _iedAdjTimer = null;

function iedAdjChange() {
  const a = ied.adj;
  a.brightness       = +document.getElementById('iedBrightness').value;
  a.contrast         = +document.getElementById('iedContrast').value;
  a.saturation       = +document.getElementById('iedSaturation').value;
  a.sharpness        = +document.getElementById('iedSharpness').value;
  a.blur             = +document.getElementById('iedBlur').value;
  a.threshold        = +document.getElementById('iedThreshold').value;
  a.thresholdEnabled =  document.getElementById('iedThresholdEnable').checked;
  a.invert           =  document.getElementById('iedInvert').checked;
  a.grayscale        =  document.getElementById('iedGrayscale').checked;
  a.red              = +document.getElementById('iedRed').value;
  a.green            = +document.getElementById('iedGreen').value;
  a.blue             = +document.getElementById('iedBlue').value;
  iedUpdateAdjLabels();
  ied.adjDirty = iedAdjNonDefault();
  document.getElementById('iedApplyBtn').disabled = !ied.adjDirty;
  clearTimeout(_iedAdjTimer);
  _iedAdjTimer = setTimeout(iedRender, 60);
}

function iedAdjNonDefault() {
  const a = ied.adj;
  return a.brightness||a.contrast||a.saturation||a.sharpness||a.blur||
         a.thresholdEnabled||a.invert||a.grayscale||a.red||a.green||a.blue;
}

function iedToggleThreshold() {
  const en = document.getElementById('iedThresholdEnable').checked;
  document.getElementById('iedThreshold').disabled = !en;
  iedAdjChange();
}

function iedUpdateAdjLabels() {
  const a = ied.adj;
  document.getElementById('iedBrightnessVal').textContent = a.brightness;
  document.getElementById('iedContrastVal').textContent   = a.contrast;
  document.getElementById('iedSaturationVal').textContent = a.saturation;
  document.getElementById('iedSharpnessVal').textContent  = a.sharpness;
  document.getElementById('iedBlurVal').textContent       = a.blur;
  document.getElementById('iedThresholdVal').textContent  = a.thresholdEnabled ? a.threshold : '—';
  document.getElementById('iedRedVal').textContent        = a.red;
  document.getElementById('iedGreenVal').textContent      = a.green;
  document.getElementById('iedBlueVal').textContent       = a.blue;
}

function iedApplyAdjustments() {
  if (!ied.hasImage || !ied.adjDirty) return;
  ied.workCtx.clearRect(0, 0, ied.width, ied.height);
  ied.workCtx.drawImage(iedC(), 0, 0);
  ied.adjDirty = false;
  iedResetAdjSliders();
  document.getElementById('iedApplyBtn').disabled = true;
  iedPushHistory('Ayarlar');
  iedToast('Ayarlar uygulandı.');
}

function iedResetAdjustments() {
  iedResetAdjSliders();
  ied.adj = { brightness:0, contrast:0, saturation:0, sharpness:0, blur:0,
              threshold:128, thresholdEnabled:false, invert:false, grayscale:false, red:0, green:0, blue:0 };
  ied.adjDirty = false;
  document.getElementById('iedApplyBtn').disabled = true;
  iedRender();
}

function iedResetAdjSliders() {
  ['iedBrightness','iedContrast','iedSaturation','iedRed','iedGreen','iedBlue'].forEach(id => { document.getElementById(id).value = 0; });
  document.getElementById('iedSharpness').value = 0;
  document.getElementById('iedBlur').value      = 0;
  document.getElementById('iedThreshold').value = 128;
  document.getElementById('iedThresholdEnable').checked = false;
  document.getElementById('iedThreshold').disabled      = true;
  document.getElementById('iedInvert').checked   = false;
  document.getElementById('iedGrayscale').checked = false;
  iedUpdateAdjLabels();
}

// ── Presets ───────────────────────────────────────────────────────────────────
function iedPreset(type) {
  if (!ied.hasImage) { iedToast('Önce bir görsel yükleyin.'); return; }
  const P = {
    shadow:    { brightness:40,  contrast:60,  saturation:-100, sharpness:2, blur:0,  threshold:180, thresholdEnabled:true,  grayscale:true,  invert:false, red:0, green:0, blue:0 },
    scan:      { brightness:20,  contrast:50,  saturation:-100, sharpness:3, blur:1,  threshold:160, thresholdEnabled:true,  grayscale:true,  invert:false, red:0, green:0, blue:0 },
    technical: { brightness:30,  contrast:80,  saturation:-100, sharpness:4, blur:0,  threshold:140, thresholdEnabled:true,  grayscale:true,  invert:false, red:0, green:0, blue:0 },
    blueprint: { brightness:-10, contrast:40,  saturation:0,    sharpness:1, blur:0,  threshold:128, thresholdEnabled:false, grayscale:false, invert:false, red:0, green:20, blue:30 },
  };
  const p = P[type]; if (!p) return;
  ied.adj = { ...p };
  document.getElementById('iedBrightness').value       = p.brightness;
  document.getElementById('iedContrast').value         = p.contrast;
  document.getElementById('iedSaturation').value       = p.saturation;
  document.getElementById('iedSharpness').value        = p.sharpness;
  document.getElementById('iedBlur').value             = p.blur;
  document.getElementById('iedThreshold').value        = p.threshold;
  document.getElementById('iedThresholdEnable').checked = p.thresholdEnabled;
  document.getElementById('iedThreshold').disabled     = !p.thresholdEnabled;
  document.getElementById('iedInvert').checked         = p.invert;
  document.getElementById('iedGrayscale').checked      = p.grayscale;
  document.getElementById('iedRed').value   = p.red;
  document.getElementById('iedGreen').value = p.green;
  document.getElementById('iedBlue').value  = p.blue;
  iedUpdateAdjLabels();
  ied.adjDirty = true;
  document.getElementById('iedApplyBtn').disabled = false;
  iedRender();
  const names = { shadow:'Gölge Sil', scan:'Tarama', technical:'Teknik Çizim', blueprint:'Blueprint' };
  iedToast(`"${names[type]}" uygulandı — sonuçtan memnunsan Uygula'ya bas.`);
}

// ── Auto threshold (Otsu) ─────────────────────────────────────────────────────
function iedAutoThreshold() {
  if (!ied.hasImage) { iedToast('Önce bir görsel yükleyin.'); return; }
  const id   = iedCX().getImageData(0, 0, ied.width, ied.height);
  const data = id.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    hist[(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]) | 0]++;
  }
  const total = data.length / 4;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v  = wB * wF * (mB - mF) ** 2;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  document.getElementById('iedThreshold').value = threshold;
  document.getElementById('iedThresholdEnable').checked = true;
  document.getElementById('iedThreshold').disabled = false;
  document.getElementById('iedGrayscale').checked = true;
  ied.adj.threshold = threshold; ied.adj.thresholdEnabled = true; ied.adj.grayscale = true;
  ied.adjDirty = true;
  document.getElementById('iedApplyBtn').disabled = false;
  iedUpdateAdjLabels();
  iedRender();
  iedToast(`Otsu eşiği: ${threshold} — Uygula ile kalıcı hale getir.`);
}

// ── History ───────────────────────────────────────────────────────────────────
function iedPushHistory(label) {
  const snap = { data: iedCX().getImageData(0,0,ied.width,ied.height), w: ied.width, h: ied.height, label };
  if (ied.historyIdx < ied.history.length - 1) ied.history.splice(ied.historyIdx + 1);
  ied.history.push(snap);
  if (ied.history.length > ied.MAX_HISTORY) ied.history.shift();
  ied.historyIdx = ied.history.length - 1;
  iedSyncHistoryUI();
}

function iedCommit(label) {
  ied.workCtx.clearRect(0, 0, ied.width, ied.height);
  ied.workCtx.drawImage(iedC(), 0, 0);
  ied.adjDirty = false;
  iedPushHistory(label);
}

function iedUndo() {
  if (ied.historyIdx <= 0) return;
  ied.historyIdx--;
  iedLoadSnap(ied.history[ied.historyIdx]);
}

function iedRedo() {
  if (ied.historyIdx >= ied.history.length - 1) return;
  ied.historyIdx++;
  iedLoadSnap(ied.history[ied.historyIdx]);
}

function iedLoadSnap(snap) {
  if (iedC().width !== snap.w || iedC().height !== snap.h) {
    [iedC(), iedOvr(), ied.workCanvas].forEach(c => { c.width = snap.w; c.height = snap.h; });
    ied.width = snap.w; ied.height = snap.h;
    document.getElementById('iedStatusSize').textContent = `${snap.w} × ${snap.h}`;
  }
  iedCX().putImageData(snap.data, 0, 0);
  ied.workCtx.putImageData(snap.data, 0, 0);
  ied.adjDirty = false;
  iedSyncHistoryUI();
}

function iedSyncHistoryUI() {
  document.getElementById('iedUndoBtn').disabled = ied.historyIdx <= 0;
  document.getElementById('iedRedoBtn').disabled = ied.historyIdx >= ied.history.length - 1;
  document.getElementById('iedStatusHistory').textContent = `Geçmiş: ${ied.historyIdx+1}/${ied.history.length}`;
}

// ── Tool management ───────────────────────────────────────────────────────────
function iedSetTool(name) {
  ied.tool = name;
  document.querySelectorAll('#page-image-editor .ied-tool').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('iedTool' + name[0].toUpperCase() + name.slice(1));
  if (btn) btn.classList.add('active');
  iedC().style.cursor = iedToolCursor();
  document.getElementById('iedStatusTool').textContent = 'Araç: ' + iedToolLabel(name);
  const showBrush  = name==='brush' || name==='eraser';
  const showMagic  = name==='magic';
  const showColor  = name==='brush' || name==='magic';
  document.getElementById('iedBrushProp').style.display = showBrush  ? 'block' : 'none';
  document.getElementById('iedMagicProp').style.display = showMagic  ? 'block' : 'none';
  document.getElementById('iedColorProp').style.display = showColor  ? 'block' : 'none';
}

function iedToolCursor() {
  return { select:'default', brush:'crosshair', eraser:'crosshair', magic:'crosshair', crop:'crosshair', eyedrop:'crosshair' }[ied.tool] || 'default';
}

function iedToolLabel(n) {
  return { select:'Seç', brush:'Fırça', eraser:'Silgi', magic:'Sihirli Değnek', crop:'Kırp', eyedrop:'Renk Seçici' }[n] || n;
}

// ── Export ────────────────────────────────────────────────────────────────────
function iedDownload() {
  if (!ied.hasImage) { iedToast('Önce bir görsel yükleyin.'); return; }
  iedC().toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gorsel-editor-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  iedToast('PNG indirildi.');
}

function iedSendToScan() {
  if (!ied.hasImage) { iedToast('Önce bir görsel yükleyin.'); return; }
  iedC().toBlob(blob => {
    const file = new File([blob], 'gorsel-editor.png', { type: 'image/png' });
    window._iedExportFile = file;
    switchTab('scan');
    setTimeout(() => {
      const inp = document.getElementById('scanFileInput');
      if (inp) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          inp.files = dt.files;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        } catch(e) { /* DataTransfer not supported, user will upload manually */ }
      }
    }, 350);
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _iedToastEl = null;
function iedToast(msg) {
  if (_iedToastEl) _iedToastEl.remove();
  const el = document.createElement('div');
  el.className = 'ied-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  _iedToastEl = el;
  setTimeout(() => { if (_iedToastEl === el) { el.remove(); _iedToastEl = null; } }, 2800);
}
