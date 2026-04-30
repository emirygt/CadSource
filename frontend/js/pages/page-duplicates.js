// ═══════════════════════════════════════════════════════
// DUPLICATE YÖNETİMİ
// ═══════════════════════════════════════════════════════
const dupState = { filter: '', page: 1, perPage: 15, total: 0, selectedFiles: new Set() };

function setDupFilter(f) {
  dupState.filter = f;
  dupState.page = 1;
  document.querySelectorAll('.dup-filter-btn').forEach(b => {
    b.style.background = '#fff'; b.style.color = '#475569';
  });
  const active = f === '' ? 'dupFilterAll' : f === 'exact_duplicate' ? 'dupFilterExact' : 'dupFilterRevision';
  const btn = document.getElementById(active);
  if (btn) { btn.style.background = '#0ea5e9'; btn.style.color = '#fff'; }
  loadDuplicatePage();
}

function dupChangePage(dir) {
  dupState.page = Math.max(1, dupState.page + dir);
  loadDuplicatePage();
}

async function loadDuplicatePage() {
  const container = document.getElementById('dupGroupsContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">Yükleniyor...</div>';
  try {
    const params = new URLSearchParams({ page: dupState.page, per_page: dupState.perPage });
    if (dupState.filter) params.set('group_type', dupState.filter === 'exact_duplicate' ? 'duplicate' : 'revision');
    const r = await fetch(`${API}/groups?${params}`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const data = await r.json();
    dupState.total = data.total || 0;
    const groups = data.groups || [];
    if (!groups.length) {
      container.innerHTML = '<div style="text-align:center;padding:60px;color:#94a3b8"><div style="font-size:48px;margin-bottom:12px">✓</div><div>Duplicate grup bulunamadı</div></div>';
      document.getElementById('dupPagination').style.display = 'none';
      return;
    }
    const DUP_TYPE = { duplicate: { label:'Tam Kopya', color:'#fee2e2', text:'#dc2626' }, revision: { label:'Revizyon', color:'#dbeafe', text:'#1d4ed8' } };
    container.innerHTML = groups.map(g => {
      const info = DUP_TYPE[g.group_type] || { label: g.group_type, color:'#f1f5f9', text:'#475569' };
      const thumbs = g.members.slice(0,4).map(m => {
        const sel = dupState.selectedFiles.has(m.file_id);
        return `<div class="dup-thumb ${sel ? 'selected' : ''}" onclick="toggleDupFileSelect(${m.file_id},this)" title="${m.filename}">
          ${m.jpg_preview ? `<img src="${m.jpg_preview}">` : `<div class="dup-thumb-fallback">${m.file_format||'?'}</div>`}
          <div class="dup-thumb-name">${m.filename}</div>
          <div class="dup-thumb-check"></div>
        </div>`;
      }).join('');
      return `<div class="dup-group-card">
        <div class="dup-group-head">
          <span class="dup-type-badge" style="background:${info.color};color:${info.text}">${info.label}</span>
          ${g.title ? `<span class="dup-group-title">${g.title}</span>` : ''}
          <span class="dup-group-count">${g.member_count} dosya</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="dup-group-action" onclick="dissolveGroup(${g.id})">Grubu Dağıt</button>
          </div>
        </div>
        <div class="dup-thumbs">${thumbs}</div>
        ${g.member_count > 4 ? `<div class="dup-more">+${g.member_count-4} dosya daha</div>` : ''}
      </div>`;
    }).join('');
    const totalPages = Math.ceil(dupState.total / dupState.perPage);
    const pag = document.getElementById('dupPagination');
    if (pag) {
      pag.style.display = totalPages > 1 ? 'flex' : 'none';
      const info = document.getElementById('dupPageInfo');
      if (info) info.textContent = `Sayfa ${dupState.page} / ${totalPages} (${dupState.total} grup)`;
      const prev = document.getElementById('dupPrevBtn'); if(prev) prev.disabled = dupState.page <= 1;
      const next = document.getElementById('dupNextBtn'); if(next) next.disabled = dupState.page >= totalPages;
    }
  } catch(e) {
    container.innerHTML = `<div style="padding:20px;color:#dc2626">Yüklenemedi: ${e.message}</div>`;
  }
}

function toggleDupFileSelect(fileId, el) {
  if (dupState.selectedFiles.has(fileId)) {
    dupState.selectedFiles.delete(fileId);
    el.classList.remove('selected');
  } else {
    dupState.selectedFiles.add(fileId);
    el.classList.add('selected');
  }
  const cnt = dupState.selectedFiles.size;
  const mergeBtn = document.getElementById('dupMergeBtn');
  const infoEl  = document.getElementById('dupSelectInfo');
  if (mergeBtn) { mergeBtn.disabled = cnt < 2; mergeBtn.style.opacity = cnt < 2 ? '0.5' : '1'; }
  if (infoEl)   infoEl.textContent = cnt > 0 ? `${cnt} dosya seçili` : '';
}

async function duplicateMergeSelected() {
  if (dupState.selectedFiles.size < 2) return;
  const fileIds = Array.from(dupState.selectedFiles);
  const r = await fetch(`${API}/groups/merge`, {
    method: 'POST', headers: { ...authH(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_ids: fileIds })
  });
  if (r.status === 401) { logout(); return; }
  dupState.selectedFiles.clear();
  document.getElementById('dupSelectInfo').textContent = '';
  const mergeBtn = document.getElementById('dupMergeBtn');
  if (mergeBtn) { mergeBtn.disabled = true; mergeBtn.style.opacity = '0.5'; }
  loadDuplicatePage();
}

async function dissolveGroup(groupId) {
  if (!confirm('Bu grubu dağıtmak istediğinizden emin misiniz?')) return;
  const r = await fetch(`${API}/groups/${groupId}/dissolve`, { method:'POST', headers: authH() });
  if (r.status === 401) { logout(); return; }
  loadDuplicatePage();
}

