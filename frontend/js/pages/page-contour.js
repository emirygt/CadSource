//  KONTUR → DXF
// ══════════════════════════════════════════════════════════════════════════════
const contourState = {
  file: null,
  result: null,
  initialized: false,
  sourceImage: null,
  calibPoints: [],
};

function initContourTab() {
  if (contourState.initialized) return;
  contourState.initialized = true;
  onContourCalibrationModeChange();
  document.getElementById('contourDetectArcs').addEventListener('change', function() {
    document.getElementById('contourArcToleranceRow').style.display = this.checked ? '' : 'none';
  });
  contourSetMsg('Görsel yükleyip "Kontur Çıkar" ile başlayabilirsiniz. Konturlu ve ölçülü preview birlikte üretilecektir.', 'info');
}

function contourSetMsg(text, type = 'info') {
  const el = document.getElementById('contourMsg');
  if (!el) return;
  el.textContent = text || '';
  if (type === 'error') el.style.color = 'var(--red)';
  else if (type === 'ok') el.style.color = 'var(--green)';
  else el.style.color = 'var(--text3)';
}

function onContourCalibrationModeChange() {
  const mode = document.getElementById('contourCalibrationMode').value;
  document.getElementById('contourCalibFields').style.display = mode === 'two_point' ? '' : 'none';
  const scaleInput = document.getElementById('contourScaleInput');
  if (scaleInput) {
    scaleInput.disabled = false;
  }
  updateContourCalibInfo();
  drawContourSourceCanvas();
}

function contourDragOver(e) {
  e.preventDefault();
  document.getElementById('contourDrop').classList.add('drag');
}

function contourDragLeave() {
  document.getElementById('contourDrop').classList.remove('drag');
}

function contourDropFile(e) {
  e.preventDefault();
  contourDragLeave();
  const f = e.dataTransfer?.files?.[0];
  if (f) setContourFile(f);
}

function contourFileSelected(e) {
  const f = e.target.files?.[0];
  if (f) setContourFile(f);
}

function updateContourCalibInfo() {
  const info = document.getElementById('contourCalibInfo');
  if (!info) return;
  const mode = document.getElementById('contourCalibrationMode').value;
  if (mode === 'auto_scan') {
    info.textContent = 'Otomatik mod: önce görsel DPI metadata\'sı, yoksa sayfa boyutu + DPI tahmini ile ölçek bulunur.';
    return;
  }
  if (mode !== 'two_point') {
    info.textContent = 'Kalibrasyon modu kapalı. Manual ölçek kullanılacak.';
    return;
  }

  const pts = contourState.calibPoints;
  if (pts.length === 0) {
    info.textContent = 'Kalibrasyon için sağ panelde önce P1 sonra P2 noktasını seçin.';
    return;
  }
  if (pts.length === 1) {
    info.textContent = `P1 seçildi: (${pts[0].x.toFixed(1)}, ${pts[0].y.toFixed(1)}). Şimdi P2 seçin.`;
    return;
  }

  const dx = pts[1].x - pts[0].x;
  const dy = pts[1].y - pts[0].y;
  const pixelDist = Math.hypot(dx, dy);
  const realDist = Number(document.getElementById('contourCalibDistance').value || 0);
  if (realDist > 0 && pixelDist > 0) {
    const measuredScale = realDist / pixelDist;
    info.textContent = `P1/P2 hazır. Piksel mesafe: ${pixelDist.toFixed(3)} px, ölçülen ölçek: ${measuredScale.toFixed(8)} unit/px`;
  } else {
    info.textContent = `P1/P2 hazır. Piksel mesafe: ${pixelDist.toFixed(3)} px`;
  }
}

function drawContourSourceCanvas() {
  const canvas = document.getElementById('contourSourceCanvas');
  const empty = document.getElementById('contourSourceEmpty');
  const img = contourState.sourceImage;

  if (!img) {
    canvas.style.display = 'none';
    empty.style.display = '';
    return;
  }

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.display = 'block';
  empty.style.display = 'none';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const pts = contourState.calibPoints;
  if (!pts.length) return;

  ctx.save();
  ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 550));
  ctx.strokeStyle = '#facc15';
  ctx.fillStyle = '#facc15';

  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  }

  pts.forEach((p, idx) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(idx === 0 ? 'P1' : 'P2', p.x + 8, p.y - 8);
    ctx.fillStyle = '#facc15';
  });
  ctx.restore();
}

function onContourSourceCanvasClick(e) {
  if (!contourState.sourceImage) return;
  if (document.getElementById('contourCalibrationMode').value !== 'two_point') return;

  const canvas = document.getElementById('contourSourceCanvas');
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);

  if (contourState.calibPoints.length >= 2) contourState.calibPoints = [];
  contourState.calibPoints.push({ x, y });
  drawContourSourceCanvas();
  updateContourCalibInfo();
}

function undoContourCalibPoint() {
  if (contourState.calibPoints.length > 0) {
    contourState.calibPoints.pop();
    drawContourSourceCanvas();
    updateContourCalibInfo();
  }
}

function resetContourCalibPoints() {
  contourState.calibPoints = [];
  drawContourSourceCanvas();
  updateContourCalibInfo();
}

function setContourFile(file) {
  const extOk = /\.(png|jpe?g|bmp|webp|tiff?)$/i.test(file.name || '');
  if (!(file.type.startsWith('image/') || extOk)) {
    contourSetMsg('Lütfen bir görsel dosyası seçin.', 'error');
    return;
  }
  contourState.file = file;
  contourState.result = null;
  contourState.calibPoints = [];
  document.getElementById('contourFname').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  document.getElementById('contourDrop').classList.add('loaded');
  document.getElementById('contourRunBtn').disabled = false;
  document.getElementById('contourDownloadBtn').disabled = true;
  document.getElementById('contourDownloadNetBtn').disabled = true;
  document.getElementById('contourStats').style.display = 'none';
  document.getElementById('contourQualityBox').style.display = 'none';
  document.getElementById('contourPreviewWrap').innerHTML = '<div class="contour-empty">İşlem için "Kontur Çıkar" butonuna basın</div>';
  document.getElementById('contourPreviewDimWrap').innerHTML = '<div class="contour-empty">Ölçülü preview işlem sonrası oluşur</div>';
  document.getElementById('contourPreviewNetWrap').innerHTML = '<div class="contour-empty">Net preview işlem sonrası oluşur</div>';
  contourSetMsg('Dosya hazır. Teknik ayarları kontrol edip kontur çıkarabilirsiniz.', 'info');

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      contourState.sourceImage = img;
      drawContourSourceCanvas();
      updateContourCalibInfo();
    };
    img.src = String(ev.target?.result || '');
  };
  reader.readAsDataURL(file);
}

function clearContourState() {
  contourState.file = null;
  contourState.result = null;
  contourState.sourceImage = null;
  contourState.calibPoints = [];
  document.getElementById('contourFileInput').value = '';
  document.getElementById('contourFname').textContent = '';
  document.getElementById('contourDrop').classList.remove('loaded');
  document.getElementById('contourRunBtn').disabled = true;
  document.getElementById('contourDownloadBtn').disabled = true;
  document.getElementById('contourDownloadNetBtn').disabled = true;
  document.getElementById('contourStats').style.display = 'none';
  document.getElementById('contourQualityBox').style.display = 'none';
  document.getElementById('contourPreviewWrap').innerHTML = '<div class="contour-empty">Henüz görsel yüklenmedi</div>';
  document.getElementById('contourPreviewDimWrap').innerHTML = '<div class="contour-empty">Henüz görsel yüklenmedi</div>';
  document.getElementById('contourPreviewNetWrap').innerHTML = '<div class="contour-empty">Henüz görsel yüklenmedi</div>';
  drawContourSourceCanvas();
  updateContourCalibInfo();
  contourSetMsg('', 'info');
}

async function runContourVectorize() {
  if (!contourState.file) {
    contourSetMsg('Önce bir görsel seçin.', 'error');
    return;
  }

  const runBtn = document.getElementById('contourRunBtn');
  const dlBtn = document.getElementById('contourDownloadBtn');
  const dlNetBtn = document.getElementById('contourDownloadNetBtn');
  runBtn.disabled = true;
  dlBtn.disabled = true;
  dlNetBtn.disabled = true;
  contourSetMsg('Teknik kontur analizi yapılıyor ve DXF hazırlanıyor...', 'info');
  document.getElementById('contourPreviewWrap').innerHTML = '<div class="loading"><div class="spinner"></div><div>İşleniyor...</div></div>';
  document.getElementById('contourPreviewDimWrap').innerHTML = '<div class="loading"><div class="spinner"></div><div>Ölçüler hazırlanıyor...</div></div>';
  document.getElementById('contourPreviewNetWrap').innerHTML = '<div class="loading"><div class="spinner"></div><div>Net görsel hazırlanıyor...</div></div>';

  const calibrationMode = document.getElementById('contourCalibrationMode').value || 'auto_scan';
  const scaleFactor = Number(document.getElementById('contourScaleInput').value || 1);
  const unit = document.getElementById('contourUnitSelect').value || 'unitless';
  const minArea = Number(document.getElementById('contourMinAreaInput').value || 16);
  const minAreaPct = Number(document.getElementById('contourMinAreaPctInput').value || 0);
  const simplify = Number(document.getElementById('contourSimplifyInput').value || 0);
  const blurSigma = Number(document.getElementById('contourBlurSigmaInput').value || 0);
  const detectCircles = document.getElementById('contourDetectCircles').checked;
  const circleTolerance = Number(document.getElementById('contourCircleTolerance').value || 0.08);
  const detectArcs = document.getElementById('contourDetectArcs').checked;
  const arcTolerance = Number(document.getElementById('contourArcTolerance').value || 0.06);
  const minSeg = Number(document.getElementById('contourMinSegInput').value || 0);
  const originMode = document.getElementById('contourOriginMode').value || 'bottom_left';
  const flipX = document.getElementById('contourFlipX').checked;
  const flipY = document.getElementById('contourFlipY').checked;
  const foregroundMode = document.getElementById('contourForegroundMode')?.value || 'part';

  if (!(scaleFactor > 0)) {
    runBtn.disabled = false;
    contourSetMsg('Ölçek çarpanı 0\'dan büyük olmalı.', 'error');
    return;
  }
  if (!(circleTolerance >= 0 && circleTolerance <= 0.5)) {
    runBtn.disabled = false;
    contourSetMsg('Circle toleransı 0 - 0.5 aralığında olmalı.', 'error');
    return;
  }

  if (calibrationMode === 'two_point') {
    if (contourState.calibPoints.length < 2) {
      runBtn.disabled = false;
      contourSetMsg('2 nokta kalibrasyonu için görüntüde P1 ve P2 seçin.', 'error');
      return;
    }
    const realDist = Number(document.getElementById('contourCalibDistance').value || 0);
    if (!(realDist > 0)) {
      runBtn.disabled = false;
      contourSetMsg('Gerçek referans mesafe 0\'dan büyük olmalı.', 'error');
      return;
    }
  }

  const fd = new FormData();
  fd.append('file', contourState.file);
  fd.append('calibration_mode', calibrationMode);
  fd.append('scale_factor', String(scaleFactor));
  fd.append('unit', unit);
  fd.append('min_area_px', String(Math.max(0, Math.round(minArea))));
  fd.append('min_area_pct', String(Math.max(0, minAreaPct)));
  fd.append('blur_sigma', String(Math.max(0, blurSigma)));
  fd.append('simplify_px', String(Math.max(0, simplify)));
  fd.append('detect_circles', String(detectCircles));
  fd.append('circle_tolerance', String(circleTolerance));
  fd.append('detect_arcs', String(detectArcs));
  fd.append('arc_tolerance', String(arcTolerance));
  fd.append('export_svg', String(document.getElementById('contourExportSvg').checked));
  fd.append('min_segment_length', String(Math.max(0, minSeg)));
  fd.append('origin_mode', originMode);
  fd.append('flip_x', String(flipX));
  fd.append('flip_y', String(flipY));
  fd.append('foreground_mode', foregroundMode);

  if (calibrationMode === 'two_point') {
    const p1 = contourState.calibPoints[0];
    const p2 = contourState.calibPoints[1];
    fd.append('calib_p1_x', String(p1.x));
    fd.append('calib_p1_y', String(p1.y));
    fd.append('calib_p2_x', String(p2.x));
    fd.append('calib_p2_y', String(p2.y));
    fd.append('calib_distance', String(Number(document.getElementById('contourCalibDistance').value || 0)));
  }

  try {
    const r = await fetch(`${API}/contour/vectorize`, { method: 'POST', headers: authH(), body: fd });
    if (r.status === 401) { logout(); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'Kontur çıkarma başarısız');

    contourState.result = d;
    renderContourResult(d);
    dlBtn.disabled = false;
    document.getElementById('contourDownloadNetBtn').disabled = false;
    const svgBtn = document.getElementById('contourDownloadSvgBtn');
    if (d.svg_base64) {
      svgBtn.style.display = '';
      svgBtn.disabled = false;
    } else {
      svgBtn.style.display = 'none';
      svgBtn.disabled = true;
    }
    const quality = d.quality || {};
    const warnCount = Array.isArray(quality.warnings) ? quality.warnings.length : 0;
    contourSetMsg(`Konturlar çıkarıldı. DXF hazır${warnCount ? ` (${warnCount} kalite notu)` : ''}.`, 'ok');
  } catch (err) {
    document.getElementById('contourPreviewWrap').innerHTML = '<div class="contour-empty" style="color:var(--red)">İşlem başarısız</div>';
    document.getElementById('contourPreviewDimWrap').innerHTML = '<div class="contour-empty" style="color:var(--red)">İşlem başarısız</div>';
    document.getElementById('contourPreviewNetWrap').innerHTML = '<div class="contour-empty" style="color:var(--red)">İşlem başarısız</div>';
    contourSetMsg(err.message || 'İşlem başarısız', 'error');
  } finally {
    runBtn.disabled = false;
  }
}

function renderContourResult(data) {
  const contourPreview = data.preview_contour || data.preview_overlay;
  const dimPreview = data.preview_dimension || null;
  const netPreview = data.preview_net || null;
  const st = data.stats || {};

  const meta = {
    'Kontur': (st.contour_count||0).toLocaleString('tr'),
    'Nokta': (st.total_points||0).toLocaleString('tr'),
    'Görsel': `${Number(st.image_width||0)} × ${Number(st.image_height||0)}`
  };

  const bindPreview = (wrapperId, imgSrc, title) => {
    const wrap = document.getElementById(wrapperId);
    if (imgSrc) {
      wrap.innerHTML = `<img src="${imgSrc}" alt="${title}" style="cursor:pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">`;
      wrap.querySelector('img').onclick = () => openPreviewModal(title, `<img src="${imgSrc}" style="width:100%;height:auto;display:block">`, meta);
    } else {
      wrap.innerHTML = '<div class="contour-empty">Preview üretilemedi</div>';
    }
  };

  bindPreview('contourPreviewWrap', contourPreview, 'Konturlu Görsel');
  bindPreview('contourPreviewDimWrap', dimPreview, 'Ölçülü Görsel');
  bindPreview('contourPreviewNetWrap', netPreview, 'Net Görsel');

  document.getElementById('contourStatCount').textContent = Number(st.contour_count || 0).toLocaleString('tr');
  document.getElementById('contourStatPoints').textContent = Number(st.total_points || 0).toLocaleString('tr');
  document.getElementById('contourStatSize').textContent = `${Number(st.image_width || 0)} × ${Number(st.image_height || 0)}`;
  const sx = Number(st.scale_factor_x ?? st.scale_factor ?? 1);
  const sy = Number(st.scale_factor_y ?? st.scale_factor ?? 1);
  const anis = Math.abs(sx - sy) > Math.max(Math.abs(sx), Math.abs(sy), 1e-9) * 1e-6;
  document.getElementById('contourStatScale').textContent = anis
    ? `${st.unit || 'unitless'} / X:${sx.toFixed(8)} Y:${sy.toFixed(8)}`
    : `${st.unit || 'unitless'} / ${sx.toFixed(8)}`;
  document.getElementById('contourStats').style.display = '';

  const q = data.quality || {};
  document.getElementById('contourQIntersect').textContent = Number(q.self_intersections || 0).toLocaleString('tr');
  document.getElementById('contourQShortSeg').textContent = Number(q.short_segments || 0).toLocaleString('tr');
  const lc = q.layer_counts || {};
  const layerText = Object.entries(lc).map(([k, v]) => `${k}:${v}`).join(' | ') || '—';
  document.getElementById('contourQLayers').textContent = layerText;
  const warnWrap = document.getElementById('contourQWarnings');
  const warnings = Array.isArray(q.warnings) ? q.warnings : [];
  warnWrap.innerHTML = '';
  warnings.forEach(w => {
    const div = document.createElement('div');
    div.className = 'contour-warning';
    div.textContent = w;
    warnWrap.appendChild(div);
  });
  document.getElementById('contourQualityBox').style.display = '';

  const c = data.calibration || {};
  const info = document.getElementById('contourCalibInfo');
  if (info && c.mode === 'two_point') {
    info.textContent = `Kalibrasyon aktif. Pixel mesafe: ${Number(c.pixel_distance || 0).toFixed(4)}, ölçülen ölçek: ${Number(c.measured_scale || 0).toFixed(8)}, efektif ölçek: ${Number(c.effective_scale || 0).toFixed(8)}`;
  } else if (info && c.mode === 'auto_scan') {
    const src = c.source || 'unknown';
    const conf = c.confidence || 'unknown';
    if (src === 'metadata_dpi' || src === 'exif_resolution') {
      info.textContent = `Otomatik kalibrasyon (${conf}): DPI kaynaklı (${Number(c.dpi_x || 0).toFixed(2)} x ${Number(c.dpi_y || 0).toFixed(2)}), efektif ölçek: ${Number(c.effective_scale || 0).toFixed(8)}`;
    } else if (src === 'page_guess') {
      info.textContent = `Otomatik kalibrasyon (${conf}): ${c.guessed_page || 'sayfa'} + ${Number(c.guessed_dpi || 0).toFixed(0)} DPI tahmini, hata: ${(Number(c.match_error || 0) * 100).toFixed(2)}%`;
    } else {
      info.textContent = `Otomatik kalibrasyon düşük güven ile fallback kullandı. Efektif ölçek: ${Number(c.effective_scale || 0).toFixed(8)}`;
    }
  }
}

function b64ToBlob(base64, mime = 'application/octet-stream') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadContourDxf(mode='raw') {
  const res = contourState.result;
  const b64 = mode === 'net' ? res.dxf_net_base64 : res.dxf_base64;
  if (!res || !b64) {
    contourSetMsg('Önce kontur üretin.', 'error');
    return;
  }
  const blob = b64ToBlob(b64, 'application/dxf');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stem = res.dxf_filename ? res.dxf_filename.replace('.dxf', '') : 'contour_output';
  a.download = mode === 'net' ? `${stem}_net.dxf` : `${stem}.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadContourSvg() {
  const res = contourState.result;
  if (!res || !res.svg_base64) {
    contourSetMsg('SVG verisi yok. "SVG de üret" seçeneğini işaretleyip tekrar çalıştırın.', 'error');
    return;
  }
  const blob = b64ToBlob(res.svg_base64, 'image/svg+xml');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stem = (res.dxf_filename || 'contour_output.dxf').replace(/\.dxf$/i, '');
  a.download = stem + '.svg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

