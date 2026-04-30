// ══════════════════════════════════════════════════════════════════════════════
//  ARAMA GEÇMİŞİ
// ══════════════════════════════════════════════════════════════════════════════

async function loadHistory() {
  const el = document.getElementById('historyList');
  const recentEl = document.getElementById('recentSearchList');
  if (!el && !recentEl) return;

  const fallbackRecent = `
    <div class="recent-item"><div class="recent-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div><div><div class="recent-name">WIN-5052</div><div class="recent-sub">Pencere Kanadı Profili</div><div class="recent-meta"><span class="recent-format">DWG</span><span>26 Nis 2026</span></div></div></div>
    <div class="recent-item"><div class="recent-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div><div><div class="recent-name">ALM-3380</div><div class="recent-sub">Kapı Kasası Profili</div><div class="recent-meta"><span class="recent-format">DXF</span><span>25 Nis 2026</span></div></div></div>
    <div class="recent-item"><div class="recent-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div><div><div class="recent-name">OSLTR-0352</div><div class="recent-sub">Cephe Sistemi Profili</div><div class="recent-meta"><span class="recent-format">PDF</span><span>24 Nis 2026</span></div></div></div>
    <div class="recent-item"><div class="recent-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div><div><div class="recent-name">FRM-2210</div><div class="recent-sub">Çerçeve Profili</div><div class="recent-meta"><span class="recent-format">DWG</span><span>23 Nis 2026</span></div></div></div>`;

  try {
    const r = await fetch(`${API}/history?limit=10`, { headers: authH() });
    if (!r.ok) return;
    const items = await r.json();
    if (!items.length) {
      if (el) el.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0">Henüz arama yapılmadı</div>';
      if (recentEl) recentEl.innerHTML = fallbackRecent;
      return;
    }

    if (recentEl) {
      recentEl.innerHTML = items.slice(0, 4).map(h => {
        const dt = h.searched_at ? new Date(h.searched_at).toLocaleString('tr-TR', { day:'2-digit', month:'short', year:'numeric' }) : '';
        const ext = String((h.query_filename || '').split('.').pop() || 'DWG').toUpperCase();
        const title = escHtml(h.query_filename || 'Arama');
        const sub = escHtml(h.category_name || 'Profil araması');
        return `<div class="recent-item" onclick="historyRedo(${h.id})" style="cursor:pointer">
          <div class="recent-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div>
          <div><div class="recent-name">${title}</div><div class="recent-sub">${sub}</div><div class="recent-meta"><span class="recent-format">${ext}</span><span>${dt}</span></div></div>
        </div>`;
      }).join('');
    }

    if (!el) return;
    el.innerHTML = items.map(h => {
      const dt = h.searched_at ? new Date(h.searched_at).toLocaleString('tr-TR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
      const catBadge = h.category_name
        ? `<span style="background:${h.category_color||'#6366f1'}22;color:${h.category_color||'#6366f1'};font-size:9px;padding:1px 5px;border-radius:10px;margin-left:4px">${h.category_name}</span>`
        : '';
      return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:7px 10px;cursor:pointer;position:relative" onclick="historyRedo(${h.id})" title="${escHtml(h.query_filename)}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
          <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(h.query_filename)}</div>
          <button onclick="event.stopPropagation();deleteHistoryItem(${h.id})" style="background:transparent;border:none;color:var(--text3);font-size:12px;cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0">✕</button>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;display:flex;align-items:center;gap:6px">
          <span>${h.result_count} sonuç</span>
          <span>·</span>
          <span>${dt}</span>
          ${catBadge}
        </div>
      </div>`;
    }).join('');
  } catch {
    if (recentEl && !recentEl.innerHTML.trim()) recentEl.innerHTML = fallbackRecent;
  }
}

async function deleteHistoryItem(id) {
  try {
    await fetch(`${API}/history/${id}`, { method: 'DELETE', headers: authH() });
    loadHistory();
  } catch {}
}

async function clearHistory() {
  if (!confirm('Tüm arama geçmişi silinsin mi?')) return;
  try {
    await fetch(`${API}/history`, { method: 'DELETE', headers: authH() });
    loadHistory();
  } catch {}
}

function historyRedo(id) {
  // Geçmiş öğesine tıklandığında sadece dosya adını göster, yeni arama için kullanıcı yeni dosya yüklemeli
  // Şimdilik sadece ilgili öğeyi highlight yapıyoruz (yeniden arama için dosya şart)
}

