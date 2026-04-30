// ───────── ATTRİBUTE TANIMLARI ─────────
let _attrDefs = [];

async function loadAttrDefs() {
  const r = await fetch(`${API}/attributes/definitions`, { headers: authH() });
  if (!r.ok) return;
  _attrDefs = await r.json();
  renderAttrDefList();
}

function renderAttrDefList() {
  const el = document.getElementById('attrDefList');
  if (!el) return;
  if (!_attrDefs.length) {
    el.innerHTML = `<p style="color:#94a3b8;font-size:13px">${t('attr.empty') || 'Henüz attribute tanımlanmadı.'}</p>`;
    return;
  }
  const typeLabel = { text: 'Metin', number: 'Sayı', boolean: 'Evet/Hayır', select: 'Seçenek' };
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${_attrDefs.map(d => `
    <div style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px">
      <div style="flex:1;font-size:13px;font-weight:600;color:#0f172a">${escHtml(d.name)}</div>
      <span style="font-size:11px;background:#f1f5f9;border-radius:5px;padding:2px 8px;color:#475569">${typeLabel[d.data_type] || d.data_type}</span>
      ${d.unit ? `<span style="font-size:11px;color:#64748b">${escHtml(d.unit)}</span>` : ''}
      ${d.required ? `<span style="font-size:11px;color:#dc2626">Zorunlu</span>` : ''}
      ${d.options?.length ? `<span style="font-size:11px;color:#94a3b8">${d.options.map(o => escHtml(o)).join(', ')}</span>` : ''}
      <button onclick="deleteAttrDef(${d.id})" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:16px;padding:0 4px;line-height:1" title="Sil">×</button>
    </div>`).join('')}</div>`;
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
  msg.style.display = 'none';
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

