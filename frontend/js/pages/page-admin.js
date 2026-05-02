const _adm = { members: [], editId: null };

function initAdminPage() {
  admSetTab('users');
  admLoadStats();
  admLoadMembers();
}

function admSetTab(tab) {
  const panels = { users: 'admPanelUsers', system: 'admPanelSystem', categories: 'admPanelCategories' };
  Object.entries(panels).forEach(([t, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.adm-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

async function admLoadStats() {
  try {
    const r = await fetch(`${API}/admin/stats`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const d = await r.json();
    document.getElementById('admStatUsers').textContent = d.active_users;
    document.getElementById('admStatFiles').textContent = Number(d.total_files).toLocaleString('tr-TR');
    document.getElementById('admStatOps').textContent = Number(d.monthly_ops).toLocaleString('tr-TR');
    document.getElementById('admStatLicense').textContent = d.license_status;
  } catch { /* ignore */ }
}

async function admLoadMembers() {
  try {
    const r = await fetch(`${API}/admin/members`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    _adm.members = await r.json();
    admRenderMembers();
  } catch { /* ignore */ }
}

function admGetCurrentEmail() {
  const token = localStorage.getItem('token');
  if (!token) return '';
  try {
    return JSON.parse(atob(token.split('.')[1])).email || '';
  } catch { return ''; }
}

function admRoleClass(role) {
  if (role === 'Admin') return 'adm-role-admin';
  if (role === 'Mühendis') return 'adm-role-engineer';
  return 'adm-role-viewer';
}

function admInitials(name) {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').substring(0, 2).toUpperCase();
}

function admRenderMembers() {
  const tbody = document.getElementById('admMembersTbody');
  if (!tbody) return;

  const currentEmail = admGetCurrentEmail();
  const initials = currentEmail ? currentEmail.substring(0, 2).toUpperCase() : 'AD';

  let html = `<tr>
    <td><div class="adm-user-cell">
      <div class="adm-avatar" style="background:linear-gradient(135deg,#0ea5e9,#6366f1)">${initials}</div>
      <div class="adm-user-name">${currentEmail.split('@')[0] || 'Admin'}</div>
    </div></td>
    <td style="font-size:13px;color:#334155">${currentEmail}</td>
    <td><span class="adm-role-badge adm-role-admin">Admin</span></td>
    <td><span class="adm-status-badge adm-status-active"><span class="adm-status-dot"></span>Aktif</span></td>
    <td style="font-size:13px;color:#64748b">—</td>
    <td style="font-size:13px;font-weight:600;color:#334155">—</td>
    <td></td>
  </tr>`;

  for (const m of _adm.members) {
    const rc = admRoleClass(m.role);
    const sc = m.status === 'active' ? 'adm-status-active' : 'adm-status-passive';
    const sl = m.status === 'active' ? 'Aktif' : 'Pasif';
    const av = admInitials(m.name);
    html += `<tr>
      <td><div class="adm-user-cell">
        <div class="adm-avatar">${av}</div>
        <div class="adm-user-name">${m.name}</div>
      </div></td>
      <td style="font-size:13px;color:#334155">${m.email}</td>
      <td><span class="adm-role-badge ${rc}">${m.role}</span></td>
      <td><span class="adm-status-badge ${sc}"><span class="adm-status-dot"></span>${sl}</span></td>
      <td style="font-size:13px;color:#64748b">${m.last_active || '—'}</td>
      <td style="font-size:13px;font-weight:600;color:#334155">${m.search_count || 0}</td>
      <td style="white-space:nowrap">
        <button class="adm-action-btn" onclick="admOpenEdit(${m.id})" title="Düzenle">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="adm-action-btn" onclick="admDeleteMember(${m.id})" title="Sil" style="color:#ef4444">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>
    </tr>`;
  }

  tbody.innerHTML = html;
}

function admOpenAdd() {
  _adm.editId = null;
  document.getElementById('admModalTitle').textContent = 'Kullanıcı Ekle';
  document.getElementById('admMemberName').value = '';
  document.getElementById('admMemberEmail').value = '';
  document.getElementById('admMemberRole').value = 'Mühendis';
  document.getElementById('admStatusGroup').style.display = 'none';
  document.getElementById('admMemberModal').classList.add('open');
}

function admOpenEdit(id) {
  const m = _adm.members.find(x => x.id === id);
  if (!m) return;
  _adm.editId = id;
  document.getElementById('admModalTitle').textContent = 'Kullanıcı Düzenle';
  document.getElementById('admMemberName').value = m.name;
  document.getElementById('admMemberEmail').value = m.email;
  document.getElementById('admMemberRole').value = m.role;
  document.getElementById('admMemberStatus').value = m.status;
  document.getElementById('admStatusGroup').style.display = '';
  document.getElementById('admMemberModal').classList.add('open');
}

function admCloseModal() {
  document.getElementById('admMemberModal').classList.remove('open');
}

async function admSaveMember() {
  const name  = document.getElementById('admMemberName').value.trim();
  const email = document.getElementById('admMemberEmail').value.trim();
  const role  = document.getElementById('admMemberRole').value;
  const status = document.getElementById('admMemberStatus').value;

  if (!name || !email) { alert('Ad ve e-posta zorunludur'); return; }

  const body   = _adm.editId ? { name, email, role, status } : { name, email, role };
  const url    = _adm.editId ? `${API}/admin/members/${_adm.editId}` : `${API}/admin/members`;
  const method = _adm.editId ? 'PUT' : 'POST';

  const r = await fetch(url, {
    method,
    headers: { ...authH(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    alert(err.detail || 'Hata oluştu');
    return;
  }

  admCloseModal();
  admLoadMembers();
  admLoadStats();
}

async function admDeleteMember(id) {
  if (!confirm('Bu üyeyi silmek istediğinize emin misiniz?')) return;
  const r = await fetch(`${API}/admin/members/${id}`, { method: 'DELETE', headers: authH() });
  if (r.ok) {
    admLoadMembers();
    admLoadStats();
  }
}
