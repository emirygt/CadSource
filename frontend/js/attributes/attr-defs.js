// ───────── ATTRİBUTE TANIMLARI ─────────
let _attrDefs = [];

async function loadAttrDefs() {
  const r = await fetch(`${API}/attributes/definitions`, { headers: authH() });
  if (!r.ok) return;
  _attrDefs = await r.json();
  renderAttrDefList();
}

const _ADF_TYPE = {
  text:    { label: 'Metin',           cls: 'adf-badge-text',    accent: '#3b82f6', iconBg: '#eff6ff', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>' },
  number:  { label: 'Sayı',            cls: 'adf-badge-number',  accent: '#8b5cf6', iconBg: '#f3e8ff', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>' },
  boolean: { label: 'Evet / Hayır',    cls: 'adf-badge-boolean', accent: '#22c55e', iconBg: '#f0fdf4', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#15803d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="7" width="22" height="10" rx="5"/><circle cx="16" cy="12" r="3" fill="#15803d" stroke="none"/></svg>' },
  select:  { label: 'Seçenek Listesi', cls: 'adf-badge-select',  accent: '#f97316', iconBg: '#fff7ed', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#c2410c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>' },
};

function renderAttrDefList() {
  const el = document.getElementById('attrDefList');
  if (!el) return;
  if (!_attrDefs.length) {
    el.innerHTML = `<div class="adf-empty">
      <div class="adf-empty-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="17" width="18" height="4" rx="1"/></svg></div>
      <div class="adf-empty-title">Henüz attribute tanımlanmadı</div>
      <div class="adf-empty-sub">Ürünlerinize özel alanlar ekleyerek detaylı bilgi saklayın</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">${_attrDefs.map(d => {
    const tp = _ADF_TYPE[d.data_type] || _ADF_TYPE.text;
    const chips = (d.options || []).map(o => `<span class="adf-option-chip">${escHtml(o)}</span>`).join('');
    return `<div class="adf-item">
      <div class="adf-item-accent" style="background:${tp.accent}"></div>
      <div class="adf-drag-handle" title="Sıralama">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
      </div>
      <div class="adf-item-body">
        <div class="adf-item-icon" style="background:${tp.iconBg}">${tp.icon}</div>
        <div style="flex:1;min-width:0">
          <div class="adf-item-name">${escHtml(d.name)}</div>
          <div class="adf-item-meta">
            <span class="adf-badge ${tp.cls}">${tp.label}</span>
            ${d.required ? `<span class="adf-badge adf-badge-required">Zorunlu</span>` : ''}
            ${d.unit ? `<span class="adf-badge adf-badge-unit">${escHtml(d.unit)}</span>` : ''}
            ${chips ? `<div class="adf-options-chips">${chips}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="adf-item-actions">
        <button class="adf-del-btn" onclick="deleteAttrDef(${d.id})" title="Sil">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function adfToggleForm() {
  const card = document.getElementById('adfFormCard');
  if (!card) return;
  const open = card.style.display === 'none' || card.style.display === '';
  card.style.display = open ? '' : 'none';
  if (open) setTimeout(() => document.getElementById('attrNameInput')?.focus(), 50);
}

function adfTypeChange() {
  const type = document.getElementById('attrTypeSelect')?.value;
  const row = document.getElementById('adfOptionsRow');
  if (row) row.style.display = type === 'select' ? '' : 'none';
}

async function addAttrDef() {
  const name = document.getElementById('attrNameInput').value.trim();
  const data_type = document.getElementById('attrTypeSelect').value;
  const unit = document.getElementById('attrUnitInput').value.trim();
  const optionsRaw = document.getElementById('attrOptionsInput').value.trim();
  const required = document.getElementById('attrRequiredChk').checked;
  const msg = document.getElementById('attrAddMsg');
  if (!name) { msg.style.display='block'; msg.style.color='#dc2626'; msg.textContent='Alan adı boş olamaz'; return; }
  const options = optionsRaw ? optionsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const r = await fetch(`${API}/attributes/definitions`, {
    method: 'POST', headers: { ...authH(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data_type, options, unit, required, sort_order: _attrDefs.length }),
  });
  if (!r.ok) { const e = await r.json(); msg.style.display='block'; msg.style.color='#dc2626'; msg.textContent=e.detail||'Hata'; return; }
  document.getElementById('attrNameInput').value = '';
  document.getElementById('attrUnitInput').value = '';
  document.getElementById('attrOptionsInput').value = '';
  document.getElementById('attrRequiredChk').checked = false;
  document.getElementById('attrTypeSelect').value = 'text';
  adfTypeChange();
  msg.style.display = 'none';
  const card = document.getElementById('adfFormCard');
  if (card) card.style.display = 'none';
  await loadAttrDefs();
}

async function deleteAttrDef(id) {
  if (!confirm('Bu attribute tanımını silmek istediğinizden emin misiniz?')) return;
  await fetch(`${API}/attributes/definitions/${id}`, { method: 'DELETE', headers: authH() });
  await loadAttrDefs();
}

// Dosya detay modal — Attributes tabı
let _fileAttrLoaded = null;
async function loadFileAttributesTab(fileId) {
  if (_fileAttrLoaded === fileId) return;
  _fileAttrLoaded = fileId;
  const panel = document.getElementById('dtAttributes');
  if (!panel) return;
  panel.innerHTML = '<div style="padding:12px 0;color:#94a3b8;font-size:13px">Yükleniyor...</div>';
  const r = await fetch(`${API}/attributes/files/${fileId}`, { headers: authH() });
  if (!r.ok) { panel.innerHTML = '<div style="color:#dc2626;font-size:13px">Yüklenemedi</div>'; return; }
  const data = await r.json();
  renderFileAttrForm(panel, fileId, data);
}

function renderFileAttrForm(panel, fileId, data) {
  const { definitions, values } = data;
  if (!definitions.length) {
    panel.innerHTML = `<p style="color:#94a3b8;font-size:13px">Henüz attribute tanımı yok. <button onclick="navGo('attr-defs',document.getElementById('nav-attr-defs'))" style="background:none;border:none;color:#0ea5e9;cursor:pointer;font-size:13px;text-decoration:underline">Tanımla →</button></p>`;
    return;
  }
  const typeLabel = { text: 'Metin', number: 'Sayı', boolean: 'Evet/Hayır', select: 'Seçenek' };
  const fields = definitions.map(d => {
    const val = values[d.name] ?? values[String(d.id)] ?? '';
    let input;
    if (d.data_type === 'boolean') {
      const checked = val === true || val === 'true' || val === '1' ? 'checked' : '';
      input = `<input type="checkbox" id="af_${d.id}" ${checked} style="width:16px;height:16px;cursor:pointer">`;
    } else if (d.data_type === 'select' && d.options?.length) {
      const opts = d.options.map(o => `<option value="${escHtml(o)}" ${val===o?'selected':''}>${escHtml(o)}</option>`).join('');
      input = `<select id="af_${d.id}" style="font-family:inherit;font-size:13px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;width:100%;outline:none"><option value=""></option>${opts}</select>`;
    } else {
      input = `<input type="${d.data_type === 'number' ? 'number' : 'text'}" id="af_${d.id}" value="${escHtml(String(val))}" style="font-family:inherit;font-size:13px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:7px;width:100%;box-sizing:border-box;outline:none" ${d.required ? 'required' : ''}>`;
    }
    return `<div style="margin-bottom:14px">
      <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:5px">${escHtml(d.name)}${d.unit ? ` <span style="font-weight:400;color:#94a3b8">(${escHtml(d.unit)})</span>` : ''}${d.required ? ' <span style="color:#dc2626">*</span>' : ''}</label>
      ${input}
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="max-width:500px">${fields}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
      <button class="btn-primary" onclick="saveFileAttr(${fileId})" style="font-size:12.5px;padding:7px 16px">${t('attr.save')||'Kaydet'}</button>
      <span id="attrSaveMsg" style="font-size:12px;color:#16a34a;display:none">${t('attr.saved')||'Kaydedildi'}</span>
    </div>`;
}

async function saveFileAttr(fileId) {
  const panel = document.getElementById('dtAttributes');
  const defs = _attrDefs.length ? _attrDefs : (await fetch(`${API}/attributes/definitions`, { headers: authH() }).then(r => r.json()));
  const values = {};
  for (const d of defs) {
    const el = document.getElementById(`af_${d.id}`);
    if (!el) continue;
    values[d.name] = d.data_type === 'boolean' ? el.checked : el.value;
  }
  const r = await fetch(`${API}/attributes/files/${fileId}`, {
    method: 'PUT', headers: { ...authH(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const msg = document.getElementById('attrSaveMsg');
  if (r.ok) {
    if (msg) { msg.style.display = 'inline'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
    // Update cached file list so warning icons reflect new values immediately
    const idx = dbLastFiles.findIndex(f => Number(f.id) === Number(fileId));
    if (idx !== -1) {
      dbLastFiles[idx] = { ...dbLastFiles[idx], attributes: values };
      renderDbTable(dbLastFiles);
    }
  } else {
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#dc2626'; msg.textContent = 'Hata'; }
  }
}

// ───────── ATTRIBUTE FILTER SEARCH ─────────
// Attribute definitions for DB-page columns + warning logic
let _dbAttrDefs = [];
let _requiredAttrNames = [];

async function loadDbAttrDefs() {
  try {
    const defs = await fetch(`${API}/attributes/definitions`, { headers: authH() }).then(r => r.json());
    _dbAttrDefs = defs || [];
    _requiredAttrNames = _dbAttrDefs.filter(d => d.required).map(d => d.name);
    updateDbTableHeader();
    if (dbLastFiles.length) renderDbTable(dbLastFiles);
  } catch (_) {}
}

function updateDbTableHeader() {
  const tr = document.getElementById('dbTableHead');
  if (!tr) return;
  tr.querySelectorAll('th[data-attr-col]').forEach(el => el.remove());
  const actionTh = tr.querySelector('.db-th-action');
  const thStyle = 'white-space:nowrap;font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.04em;text-transform:uppercase;padding:10px 12px';
  for (const def of _dbAttrDefs) {
    const th = document.createElement('th');
    th.setAttribute('data-attr-col', def.name);
    th.style.cssText = thStyle;
    th.textContent = def.name + (def.unit ? ` (${def.unit})` : '');
    tr.insertBefore(th, actionTh);
  }
  const totalCols = 11 + _dbAttrDefs.length;
  document.querySelectorAll('#dbTableBody td[colspan]').forEach(td => td.setAttribute('colspan', totalCols));
}

function _fileMissingAttrs(file) {
  if (!_dbAttrDefs.length) return [];
  const attrs = file.attributes || {};
  return _dbAttrDefs.filter(d => d.required).filter(d => {
    const v = attrs[d.name];
    return v === null || v === undefined || String(v).trim() === '' || v === false;
  }).map(d => d.name);
}

