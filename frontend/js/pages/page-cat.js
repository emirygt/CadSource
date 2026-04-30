// ══════════════════════════════════════════════════════════════════════════════
//  KATEGORİLER
// ══════════════════════════════════════════════════════════════════════════════
let catState = [];

async function loadCategories() {
  try {
    const r = await fetch(`${API}/categories`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    catState = await r.json();
    renderCategories();
  } catch {
    document.getElementById('catListBody').innerHTML = '<div class="cat-empty">Yüklenemedi.</div>';
  }
}

function renderCategories() {
  const badge = document.getElementById('catListBadge');
  badge.textContent = `(${catState.length})`;
  const body = document.getElementById('catListBody');
  if (!catState.length) {
    body.innerHTML = '<div class="cat-empty">Henüz kategori yok. Yukarıdan ekleyin.</div>';
    return;
  }
  body.innerHTML = catState.map(c => `
    <div class="cat-item" id="cat-row-${c.id}">
      <div class="cat-dot" style="background:${c.color}"></div>
      <div class="cat-info">
        <div class="cat-name" id="cat-name-${c.id}">${c.name}</div>
        <div class="cat-count">${c.file_count} dosya</div>
      </div>
      <div class="cat-edit-row" id="cat-view-${c.id}">
        <button class="cat-btn" onclick="startEditCat(${c.id})">Düzenle</button>
        <button class="cat-btn danger" onclick="deleteCat(${c.id},'${c.name.replace(/'/g,"\\'")}')">Sil</button>
      </div>
      <div class="cat-edit-row" id="cat-edit-${c.id}" style="display:none">
        <input class="cat-edit-input" id="cat-edit-name-${c.id}" value="${c.name}" maxlength="60">
        <input type="color" id="cat-edit-color-${c.id}" value="${c.color}" style="width:28px;height:28px;border:1px solid var(--border2);border-radius:4px;background:var(--bg3);cursor:pointer;padding:1px">
        <button class="cat-btn save" onclick="saveCat(${c.id})">Kaydet</button>
        <button class="cat-btn" onclick="cancelEditCat(${c.id})">İptal</button>
      </div>
    </div>
  `).join('');
}

function startEditCat(id) {
  document.getElementById(`cat-view-${id}`).style.display = 'none';
  document.getElementById(`cat-edit-${id}`).style.display = 'flex';
  document.getElementById(`cat-edit-name-${id}`).focus();
}

function cancelEditCat(id) {
  document.getElementById(`cat-view-${id}`).style.display = 'flex';
  document.getElementById(`cat-edit-${id}`).style.display = 'none';
}

async function saveCat(id) {
  const name  = document.getElementById(`cat-edit-name-${id}`).value.trim();
  const color = document.getElementById(`cat-edit-color-${id}`).value;
  if (!name) return;
  try {
    const r = await fetch(`${API}/categories/${id}`, {
      method: 'PUT', headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    if (!r.ok) { const d = await r.json(); alert(d.detail || 'Hata'); return; }
    await loadCategories();
    loadCategoriesIntoSelect();
  } catch { alert('Kaydedilemedi.'); }
}

async function deleteCat(id, name) {
  if (!confirm(`"${name}" silinsin mi?\nBu kategorideki dosyalar kategorisiz kalır.`)) return;
  try {
    const r = await fetch(`${API}/categories/${id}`, { method: 'DELETE', headers: authH() });
    if (!r.ok) return;
    await loadCategories();
    loadCategoriesIntoSelect();
    loadDbFiles();
  } catch { alert('Silinemedi.'); }
}

async function addCategory() {
  const name  = document.getElementById('catNameInput').value.trim();
  const color = document.getElementById('catColorInput').value;
  const msg   = document.getElementById('catAddMsg');
  if (!name) { showCatMsg('Kategori adı boş olamaz.', 'error'); return; }
  try {
    const r = await fetch(`${API}/categories`, {
      method: 'POST', headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    const d = await r.json();
    if (!r.ok) { showCatMsg(d.detail || 'Hata', 'error'); return; }
    document.getElementById('catNameInput').value = '';
    showCatMsg(`"${d.name}" eklendi.`, 'ok');
    await loadCategories();
    loadCategoriesIntoSelect();
  } catch { showCatMsg('Eklenemedi.', 'error'); }
}

function showCatMsg(text, type) {
  const el = document.getElementById('catAddMsg');
  el.textContent = text;
  el.style.color = type === 'ok' ? 'var(--green)' : 'var(--red)';
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

async function downloadCategoryTemplate() {
  try {
    const r = await fetch(`${API}/categories/template`, { headers: authH() });
    const ct = (r.headers.get('content-type') || '').toLowerCase();

    if (!r.ok) {
      let msg = 'Template indirilemedi.';
      try {
        const d = await r.json();
        if (d && d.detail) msg = d.detail;
      } catch {}
      alert(msg);
      return;
    }

    if (!ct.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
      alert('Sunucudan geçerli Excel dosyası gelmedi. Lütfen tekrar giriş yapın.');
      return;
    }

    const cd = r.headers.get('content-disposition') || '';
    const m = cd.match(/filename=\"?([^\";]+)\"?/i);
    const filename = (m && m[1]) ? m[1] : 'kategori_template.xlsx';
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    alert('Template indirilemedi.');
  }
}

async function importCategoryExcel(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const status = document.getElementById('catImportStatus');
  const result = document.getElementById('catImportResult');
  status.textContent = 'Yükleniyor...';
  result.style.display = 'none';
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch(`${API}/categories/import`, { method: 'POST', headers: authH(), body: fd });
    const d = await r.json();
    if (!r.ok) { status.textContent = d.detail || 'Hata'; return; }
    status.textContent = '';
    let html = `<b style="color:#16a34a">✓ ${d.success_count}/${d.total_rows} satır içe aktarıldı</b>`;
    if (d.error_count > 0) {
      html += `<b style="color:#dc2626;margin-left:12px">✗ ${d.error_count} hata</b>`;
      html += '<ul style="margin:6px 0 0;padding-left:18px">'
        + d.errors.map(e => `<li>Satır ${e.row}: ${e.message}</li>`).join('')
        + '</ul>';
    }
    result.innerHTML = html;
    result.style.display = '';
    await loadCategories();
    loadCategoriesIntoSelect();
  } catch { status.textContent = 'İçe aktarma başarısız.'; }
}

// DB sekmesindeki kategori dropdown'ını doldur
async function loadCategoriesIntoSelect() {
  try {
    const r = await fetch(`${API}/categories`, { headers: authH() });
    if (!r.ok) return;
    const cats = await r.json();

    // DB sekmesi — upload kategori seçici
    const dbSel = document.getElementById('dbCategorySelect');
    if (dbSel) {
      const dbCurrent = dbSel.value;
      dbSel.innerHTML = '<option value="">— Kategori seçin (isteğe bağlı) —</option>'
        + cats.map(c => `<option value="${c.id}" ${dbCurrent == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    }

    // Ara sekmesi — kategori filtresi
    const searchSel = document.getElementById('searchCategorySelect');
    if (searchSel) {
      const searchCurrent = searchSel.value;
      searchSel.innerHTML = '<option value="">Tüm kategoriler</option>'
        + cats.map(c => `<option value="${c.id}" ${searchCurrent == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
      renderSearchCategoryChips();
    }

    // Filtre bar — kategori seçici
    const filterCat = document.getElementById('dbFilterCategory');
    if (filterCat) {
      const fcCurrent = filterCat.value;
      filterCat.innerHTML = '<option value="">Tümü</option>'
        + cats.map(c => `<option value="${c.id}" ${fcCurrent == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
    }
  } catch {}
}

