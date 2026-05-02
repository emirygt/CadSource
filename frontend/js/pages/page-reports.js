async function downloadReport(type) {
  const fmt = document.getElementById(`rp-${type}-fmt`)?.value || 'xlsx';
  const btn = document.querySelector(`#rp-${type}-meta`)?.closest('.rp-card')?.querySelector('.rp-btn');
  const meta = document.getElementById(`rp-${type}-meta`);
  if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanıyor...'; }
  if (meta) meta.textContent = '';
  try {
    const r = await fetch(`${API}/reports/${type}?fmt=${fmt}`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename=([^\s;]+)/);
    const filename = match ? match[1] : `${type}-report.${fmt}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (meta) meta.textContent = `✓ İndirildi — ${new Date().toLocaleTimeString('tr-TR')}`;
  } catch (e) {
    if (meta) meta.textContent = `Hata: ${e.message}`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 11 5 5 5-5"/><path d="M20 16.5v2.5a2 2 0 01-2 2H6a2 2 0 01-2-2v-2.5"/></svg> İndir`;
    }
  }
}
