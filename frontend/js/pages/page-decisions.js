// ══════════════════════════════════════════════════════
//  Karar Kayıtları Sayfası
// ══════════════════════════════════════════════════════

const decState = {
  filter: '',
  offset: 0,
  limit:  20,
  total:  0,
};

const DEC_LABELS = {
  usable:     { text: 'Kullanılabilir', cls: 'dec-badge-usable',     icon: '✓' },
  substitute: { text: 'Muadil',         cls: 'dec-badge-substitute', icon: 'ℹ' },
  reject:     { text: 'Uygun Değil',    cls: 'dec-badge-reject',     icon: '✕' },
};

async function initPageDecisions() {
  decState.offset = 0;
  await decLoad();
}

function decSetFilter(el, type) {
  decState.filter = type;
  decState.offset = 0;
  document.querySelectorAll('.dec-ftab').forEach(b => b.classList.toggle('active', b === el));
  decLoad();
}

function decPage(dir) {
  decState.offset = Math.max(0, decState.offset + dir * decState.limit);
  decLoad();
}

async function decLoad() {
  const body  = document.getElementById('decTableBody');
  const count = document.getElementById('decCount');
  if (!body) return;

  body.innerHTML = `<tr><td colspan="8" class="dec-loading">Yükleniyor…</td></tr>`;

  try {
    const qs = new URLSearchParams({
      limit:  decState.limit,
      offset: decState.offset,
      ...(decState.filter ? { decision_type: decState.filter } : {}),
    });
    const r = await fetch(`${API}/decisions?${qs}`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) throw new Error(r.status);

    const data = await r.json();
    decState.total = data.total || 0;

    if (count) count.textContent = `${decState.total} kayıt`;

    if (!data.items || !data.items.length) {
      body.innerHTML = `<tr><td colspan="8" class="dec-empty">Henüz karar kaydı yok.</td></tr>`;
      document.getElementById('decPagination').style.display = 'none';
      return;
    }

    body.innerHTML = data.items.map(item => {
      const badge  = DEC_LABELS[item.decision_type] || { text: item.decision_label, cls: '', icon: '?' };
      const sim    = item.similarity_score != null ? `%${Math.round(item.similarity_score)}` : '—';
      const simCls = item.similarity_score >= 80 ? 'dec-sim-high' : item.similarity_score >= 60 ? 'dec-sim-mid' : 'dec-sim-low';
      const dateStr = item.decided_at
        ? new Date(item.decided_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
      const who   = item.decided_by ? item.decided_by.split('@')[0] : '—';
      const notes = item.notes ? `<span title="${escHtml(item.notes)}" class="dec-notes-preview">${escHtml(item.notes.slice(0,40))}${item.notes.length > 40 ? '…' : ''}</span>` : '<span class="dec-no-notes">—</span>';

      return `<tr class="dec-row">
        <td class="dec-fn dec-fn-ref" title="${escHtml(item.reference_filename)}">${escHtml(item.reference_filename)}</td>
        <td class="dec-fn dec-fn-cmp" title="${escHtml(item.compared_filename)}">${escHtml(item.compared_filename)}</td>
        <td><span class="dec-sim ${simCls}">${sim}</span></td>
        <td><span class="dec-badge ${badge.cls}">${badge.icon} ${badge.text}</span></td>
        <td>${notes}</td>
        <td class="dec-date">${dateStr}</td>
        <td class="dec-who">${who}</td>
        <td><button class="dec-del-btn" onclick="decDelete(${item.id}, this)" title="Sil">✕</button></td>
      </tr>`;
    }).join('');

    // Pagination
    const pages = Math.ceil(decState.total / decState.limit);
    const page  = Math.floor(decState.offset / decState.limit) + 1;
    const pag   = document.getElementById('decPagination');
    pag.style.display = pages > 1 ? 'flex' : 'none';
    document.getElementById('decPageInfo').textContent = `${page} / ${pages}`;
    document.getElementById('decPrevBtn').disabled = decState.offset === 0;
    document.getElementById('decNextBtn').disabled = decState.offset + decState.limit >= decState.total;

  } catch (e) {
    body.innerHTML = `<tr><td colspan="8" class="dec-empty" style="color:#dc2626">Yüklenemedi: ${e.message}</td></tr>`;
  }
}

async function decDelete(id, btn) {
  if (!confirm('Bu karar kaydı silinsin mi?')) return;
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch(`${API}/decisions/${id}`, { method: 'DELETE', headers: authH() });
    if (!r.ok) throw new Error(r.status);
    decLoad();
  } catch (e) {
    btn.disabled = false; btn.textContent = '✕';
    alert('Silinemedi: ' + e.message);
  }
}
