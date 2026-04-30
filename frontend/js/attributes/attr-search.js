let _asAttrDefs = [];
let _asPage = 1;
const _asPerPage = 24;

async function loadAttrSearchFilters() {
  // Categories
  const catSel = document.getElementById('asFilterCat');
  if (catSel && catSel.options.length <= 1) {
    try {
      const cats = await fetch(`${API}/categories`, { headers: authH() }).then(r => r.json());
      (cats || []).forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        catSel.appendChild(o);
      });
    } catch (_) {}
  }
  // Custom attr definitions
  try {
    const defs = await fetch(`${API}/attributes/definitions`, { headers: authH() }).then(r => r.json());
    _asAttrDefs = defs || [];
    renderAttrCustomFilters();
  } catch (_) {}
}

function renderAttrCustomFilters() {
  const wrap = document.getElementById('asCustomFilters');
  const grid = document.getElementById('asCustomFilterGrid');
  if (!wrap || !grid) return;
  if (!_asAttrDefs.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  grid.innerHTML = _asAttrDefs.map(def => {
    const inputStyle = 'font-family:inherit;font-size:12px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;width:100%;box-sizing:border-box';
    let input = '';
    if (def.data_type === 'text') {
      input = `<input type="text" id="asAttr_${def.id}" placeholder="${escHtml(def.name)}..." style="${inputStyle}">`;
    } else if (def.data_type === 'number') {
      input = `<div style="display:flex;gap:6px;align-items:center">
        <input type="number" id="asAttrMin_${def.id}" placeholder="Min${def.unit ? ' ('+escHtml(def.unit)+')' : ''}" style="flex:1;font-family:inherit;font-size:12px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:7px;outline:none">
        <span style="color:#94a3b8;font-size:12px">—</span>
        <input type="number" id="asAttrMax_${def.id}" placeholder="Max" style="flex:1;font-family:inherit;font-size:12px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:7px;outline:none">
      </div>`;
    } else if (def.data_type === 'boolean') {
      input = `<select id="asAttr_${def.id}" style="${inputStyle}">
        <option value="">Tümü</option>
        <option value="true">Evet</option>
        <option value="false">Hayır</option>
      </select>`;
    } else if (def.data_type === 'select') {
      const opts = (def.options || []).map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
      input = `<select id="asAttr_${def.id}" style="${inputStyle}"><option value="">Tümü</option>${opts}</select>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px">
      <label style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.05em;text-transform:uppercase">${escHtml(def.name)}${def.unit ? ' ('+escHtml(def.unit)+')' : ''}</label>
      ${input}
    </div>`;
  }).join('');
}

function _buildAttrSearchBody(page) {
  const catId = document.getElementById('asFilterCat')?.value;
  const fmts = [...document.querySelectorAll('.as-fmt-chk:checked')].map(el => el.value);
  const eMin = document.getElementById('asEntityMin')?.value;
  const eMax = document.getElementById('asEntityMax')?.value;
  const bwMin = document.getElementById('asBwMin')?.value;
  const bwMax = document.getElementById('asBwMax')?.value;
  const bhMin = document.getElementById('asBhMin')?.value;
  const bhMax = document.getElementById('asBhMax')?.value;
  const layer = document.getElementById('asLayer')?.value?.trim();

  const body = {
    page,
    per_page: _asPerPage,
    formats: fmts,
    attr_filters: [],
  };
  if (catId) body.category_id = parseInt(catId);
  if (eMin) body.entity_min = parseInt(eMin);
  if (eMax) body.entity_max = parseInt(eMax);
  if (bwMin) body.bbox_w_min = parseFloat(bwMin);
  if (bwMax) body.bbox_w_max = parseFloat(bwMax);
  if (bhMin) body.bbox_h_min = parseFloat(bhMin);
  if (bhMax) body.bbox_h_max = parseFloat(bhMax);
  if (layer) body.layer = layer;

  for (const def of _asAttrDefs) {
    if (def.data_type === 'number') {
      const mn = document.getElementById(`asAttrMin_${def.id}`)?.value;
      const mx = document.getElementById(`asAttrMax_${def.id}`)?.value;
      if (mn || mx) body.attr_filters.push({ name: def.name, data_type: 'number', min: mn ? parseFloat(mn) : null, max: mx ? parseFloat(mx) : null });
    } else {
      const val = document.getElementById(`asAttr_${def.id}`)?.value;
      if (val) body.attr_filters.push({ name: def.name, data_type: def.data_type, value: def.data_type === 'boolean' ? (val === 'true') : val });
    }
  }
  return body;
}

async function runAttrSearch(page) {
  _asPage = page || 1;
  const area = document.getElementById('nlResultsArea');
  const countEl = document.getElementById('asResultCount');
  area.innerHTML = '<p style="color:#64748b;font-size:13px;padding:8px 0">Aranıyor...</p>';
  if (countEl) countEl.textContent = '';
  try {
    const r = await fetch(`${API}/attr-search`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify(_buildAttrSearchBody(_asPage)),
    });
    if (!r.ok) { area.innerHTML = `<p style="color:#ef4444;font-size:13px">Hata: ${r.status}</p>`; return; }
    renderAttrSearchResults(await r.json());
  } catch (e) {
    area.innerHTML = `<p style="color:#ef4444;font-size:13px">Bağlantı hatası: ${e.message}</p>`;
  }
}

function renderAttrSearchResults(data) {
  const area = document.getElementById('nlResultsArea');
  const countEl = document.getElementById('asResultCount');
  if (countEl) countEl.textContent = `${(data.total || 0).toLocaleString('tr')} sonuç`;

  if (!data.files?.length) {
    area.innerHTML = `<p style="color:#64748b;font-size:13px;padding:8px 0">Eşleşen ürün bulunamadı.</p>`;
    return;
  }

  const cards = data.files.map(f => {
    const fmt = (f.file_format || '').toUpperCase();
    const fmtColor = { DWG: '#6d28d9', DXF: '#0369a1', PDF: '#b91c1c', JPG: '#a16207' }[fmt] || '#475569';
    const preview = f.jpg_preview
      ? `<img src="data:image/jpeg;base64,${f.jpg_preview}" style="width:100%;height:120px;object-fit:contain;background:#f8fafc;border-radius:6px;margin-bottom:10px;cursor:pointer" onclick="showDetailModal(${f.id})">`
      : `<div style="width:100%;height:120px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;margin-bottom:10px;cursor:pointer" onclick="showDetailModal(${f.id})">${fmt||'FILE'}</div>`;
    const attrs = f.attributes || {};
    const attrChips = Object.entries(attrs).filter(([,v]) => v !== null && v !== '' && v !== false).map(([k,v]) =>
      `<span style="font-size:10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:1px 6px;color:#475569;white-space:nowrap">${escHtml(k)}: <b>${escHtml(String(v))}</b></span>`
    ).join('');
    const catTag = f.category_name ? `<span style="font-size:10px;color:#6366f1;font-weight:600">${escHtml(f.category_name)}</span>` : '';
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;flex-direction:column;cursor:pointer" onclick="showDetailModal(${f.id})">
      ${preview}
      <div style="font-size:12px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.filename)}">${escHtml(f.filename)}</div>
      <div style="margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;color:${fmtColor};background:${fmtColor}18;border-radius:4px;padding:1px 6px">${fmt}</span>
        ${catTag}
        ${f.entity_count ? `<span style="font-size:10px;color:#94a3b8">${f.entity_count} entity</span>` : ''}
        ${(f.bbox_width && f.bbox_height) ? `<span style="font-size:10px;color:#94a3b8">${f.bbox_width.toFixed(0)}×${f.bbox_height.toFixed(0)}</span>` : ''}
      </div>
      ${attrChips ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${attrChips}</div>` : ''}
    </div>`;
  }).join('');

  const pages = Math.ceil(data.total / _asPerPage);
  const pager = pages > 1 ? `<div style="display:flex;justify-content:center;gap:8px;margin-top:20px;flex-wrap:wrap">
    ${_asPage > 1 ? `<button onclick="runAttrSearch(${_asPage-1})" style="font-size:12px;padding:6px 14px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;cursor:pointer">← Önceki</button>` : ''}
    <span style="font-size:12px;color:#64748b;align-self:center">Sayfa ${_asPage} / ${pages}</span>
    ${_asPage < pages ? `<button onclick="runAttrSearch(${_asPage+1})" style="font-size:12px;padding:6px 14px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;cursor:pointer">Sonraki →</button>` : ''}
  </div>` : '';

  area.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px">${cards}</div>${pager}`;
}

function resetAttrSearch() {
  document.getElementById('asFilterCat').value = '';
  document.querySelectorAll('.as-fmt-chk').forEach(el => el.checked = false);
  ['asEntityMin','asEntityMax','asBwMin','asBwMax','asBhMin','asBhMax','asLayer'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  for (const def of _asAttrDefs) {
    const el = document.getElementById(`asAttr_${def.id}`) || document.getElementById(`asAttrMin_${def.id}`);
    if (el) el.value = '';
    const el2 = document.getElementById(`asAttrMax_${def.id}`);
    if (el2) el2.value = '';
  }
  document.getElementById('nlResultsArea').innerHTML = '';
  const c = document.getElementById('asResultCount'); if (c) c.textContent = '';
}
