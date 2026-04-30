//  PREVIEW — sidebar (Ara sekmesi) + modal (DB sekmesi)
// ══════════════════════════════════════════════════════════════════════════════

// Tarayıcıda DXF raw parse edip SVG üret (backend'e gitmeden)
function parseDxfToSvg(text, w, h) {
  const lines = text.split('\n');
  const entities = [];
  let inEntities = false, i = 0;
  while (i < lines.length) {
    const ln = lines[i].trim();
    if (ln === 'ENTITIES') inEntities = true;
    if (ln === 'ENDSEC' && inEntities) { inEntities = false; }
    if (!inEntities) { i++; continue; }
    if (['LINE','CIRCLE','ARC','LWPOLYLINE','POLYLINE'].includes(ln)) {
      const etype = ln;
      const ent = { type: etype, layer: '0', x1:0, y1:0, x2:0, y2:0, r:0, sa:0, ea:90 };
      i++;
      let depth = 0;
      while (i < lines.length && depth < 200) {
        const code = parseInt(lines[i]?.trim());
        const val = lines[i+1]?.trim() || '';
        i += 2;
        if (isNaN(code) || code === 0) { i -= 2; break; }
        if (code === 8)  ent.layer = val;
        if (code === 10) ent.x1 = parseFloat(val)||0;
        if (code === 20) ent.y1 = parseFloat(val)||0;
        if (code === 11) ent.x2 = parseFloat(val)||0;
        if (code === 21) ent.y2 = parseFloat(val)||0;
        if (code === 40) ent.r  = parseFloat(val)||0;
        if (code === 50) ent.sa = parseFloat(val)||0;
        if (code === 51) ent.ea = parseFloat(val)||0;
        depth++;
      }
      entities.push(ent);
    } else { i++; }
  }
  if (!entities.length) return null;

  const xs = entities.flatMap(e => [e.x1, e.x2]);
  const ys = entities.flatMap(e => [e.y1, e.y2]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
  const by0 = Math.min(...ys), by1 = Math.max(...ys);
  const bw = (bx1-bx0)||1, bh = (by1-by0)||1;
  const pad = 16, vw = w-pad*2, vh = h-pad*2;
  const sx = x => pad + (x-bx0)/bw*vw;
  const sy = y => pad + (1-(y-by0)/bh)*vh;

  const colors = ['#60a5fa','#34d399','#f59e0b','#f87171','#a78bfa','#38bdf8'];
  const layerIdx = {};
  const lc = l => { if (!(l in layerIdx)) layerIdx[l]=Object.keys(layerIdx).length; return colors[layerIdx[l]%colors.length]; };

  const svgLines = [];
  for (const e of entities.slice(0, 3000)) {
    const c = lc(e.layer);
    if (e.type === 'LINE') {
      svgLines.push(`<line x1="${sx(e.x1).toFixed(1)}" y1="${sy(e.y1).toFixed(1)}" x2="${sx(e.x2).toFixed(1)}" y2="${sy(e.y2).toFixed(1)}" stroke="${c}" stroke-width="0.8"/>`);
    } else if (e.type === 'CIRCLE' && e.r > 0) {
      const rp = e.r/bw*vw;
      if (rp > 0.3 && rp < vw) svgLines.push(`<circle cx="${sx(e.x1).toFixed(1)}" cy="${sy(e.y1).toFixed(1)}" r="${rp.toFixed(1)}" stroke="${c}" fill="none" stroke-width="0.8"/>`);
    } else if (e.type === 'ARC' && e.r > 0) {
      const rp = e.r/bw*vw;
      if (rp < 1 || rp > vw) continue;
      const sa = e.sa*Math.PI/180, ea = e.ea*Math.PI/180;
      let sweep = ea - sa; if (sweep < 0) sweep += 2*Math.PI;
      const large = sweep > Math.PI ? 1 : 0;
      const x1a = sx(e.x1 + e.r*Math.cos(sa)), y1a = sy(e.y1 + e.r*Math.sin(sa));
      const x2a = sx(e.x1 + e.r*Math.cos(ea)), y2a = sy(e.y1 + e.r*Math.sin(ea));
      svgLines.push(`<path d="M${x1a.toFixed(1)},${y1a.toFixed(1)} A${rp.toFixed(1)},${rp.toFixed(1)} 0 ${large},0 ${x2a.toFixed(1)},${y2a.toFixed(1)}" stroke="${c}" fill="none" stroke-width="0.8"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="background:#f1f5f9;display:block;width:100%;height:auto">${svgLines.join('')}</svg>`;
}

// Ara sekmesi: dosya seçilince sidebar'da önizle
function previewFileInSidebar(file) {
  const wrap = document.getElementById('sidebarPreview');
  const svgEl = document.getElementById('sidebarPreviewSvg');
  const info = document.getElementById('sidebarPreviewInfo');
  wrap.style.display = '';
  svgEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Yükleniyor...</div>';

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const svg = parseDxfToSvg(text, 248, 180);
    if (svg) {
      svgEl.innerHTML = svg;
      // entity sayısını say
      const lineCount = (text.match(/^LINE\s*$/mg)||[]).length;
      const circCount = (text.match(/^CIRCLE\s*$/mg)||[]).length;
      info.textContent = `${lineCount} çizgi · ${circCount} daire`;
    } else {
      svgEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Önizleme yok<br><span style="font-size:10px">DWG veya hatalı DXF</span></div>';
      info.textContent = '';
    }
  };
  reader.readAsText(file);
}

// DB sekmesi: kayıtlı dosyanın SVG'sini modal'da göster
const dbFileSvgCache = {};

async function showDbPreview(fileId) {
  // Cache'te var mı?
  if (!dbFileSvgCache[fileId]) {
    try {
      const r = await fetch(`${API}/files/${fileId}`, { headers: authH() });
      if (!r.ok) return;
      const d = await r.json();
      dbFileSvgCache[fileId] = d;
    } catch { return; }
  }
  const f = dbFileSvgCache[fileId];
  openPreviewModal(f.filename, f.svg_preview, {
    'Entity': (f.entity_count||0).toLocaleString('tr'),
    'Katman': f.layer_count||0,
    'Format': (f.file_format||'').toUpperCase(),
    'Boyut': (f.bbox_width && f.bbox_height) ? `${f.bbox_width.toFixed(0)} × ${f.bbox_height.toFixed(0)}` : '—',
  });
}

function openPreviewModal(title, svgContent, meta) {
  document.getElementById('modalTitle').textContent = title;
  const svgWrap = document.getElementById('modalSvgWrap');
  if (svgContent) {
    // viewBox'u büyük yap
    const enlarged = svgContent.replace(/width="\d+"/, 'width="720"').replace(/height="\d+"/, 'height="520"');
    svgWrap.innerHTML = enlarged;
    svgWrap.style.display = '';
  } else {
    svgWrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">Bu dosya için önizleme yok</div>';
  }
  document.getElementById('modalMeta').innerHTML = Object.entries(meta||{}).map(([k,v]) =>
    `<div class="modal-meta-item"><div class="modal-meta-label">${k}</div><div class="modal-meta-val">${v}</div></div>`
  ).join('');
  document.getElementById('previewModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePreviewModal() {
  document.getElementById('previewModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function closeModal(e) {
  if (e.target === document.getElementById('previewModal')) closePreviewModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePreviewModal();
    closeDetailModal();
    closeCompareModal();
    closeJobModal();
  }
});

