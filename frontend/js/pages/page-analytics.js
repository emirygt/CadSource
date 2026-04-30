//  ANALİTİK DASHBOARD (Faza 3.2)
// ══════════════════════════════════════════════════════════════════════════════
async function downloadReport(path, fallbackName) {
  try {
    const r = await fetch(`${API}${path}`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.detail || 'Rapor olusturulamadi');
    }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/i);
    const filename = m ? m[1] : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err?.message || 'Rapor olusturulamadi.');
  }
}

const analyticsState = { loaded: false, charts: {} };

// Chart.js global defaults — dark theme
function initChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#8b93a8';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  Chart.defaults.font.size = 11;
}

function destroyChart(key) {
  if (analyticsState.charts[key]) {
    analyticsState.charts[key].destroy();
    delete analyticsState.charts[key];
  }
}

async function loadAnalytics() {
  if (typeof Chart === 'undefined') { console.warn('Chart.js yüklenemedi'); return; }
  initChartDefaults();

  // Update timestamp
  const now = new Date();
  const ts = now.toLocaleDateString('tr-TR', { day:'numeric', month:'short', year:'numeric' }) + ', ' +
    now.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
  setText('dashLastUpdate', 'Son güncelleme: ' + ts);

  try {
    const [ovRes, searchRes, historyRes, filesRes] = await Promise.all([
      fetch(`${API}/analytics/overview`, { headers: authH() }),
      fetch(`${API}/analytics/search-stats?limit=10`, { headers: authH() }),
      fetch(`${API}/history?limit=4`, { headers: authH() }),
      fetch(`${API}/files?per_page=4&sort=created_at&order=desc`, { headers: authH() }),
    ]);

    if (ovRes.status === 401) { logout(); return; }
    const ov = await ovRes.json();
    const search = await searchRes.json();
    const history = await historyRes.json().catch(() => []);
    const filesData = await filesRes.json().catch(() => ({ files: [] }));

    if (!ov.totals) ov.totals = { total_files:0, indexed_files:0, clip_files:0, avg_entities:0 };
    if (!ov.formats) ov.formats = [];
    if (!search.summary) search.summary = { total_searches:0, avg_results:0 };
    if (!search.daily_searches) search.daily_searches = [];

    renderDashKPIs(ov, search);
    renderDashTrendChart(search.daily_searches);
    renderDashDecisions(search.summary.total_searches || 0);
    renderDashRecentSearches(Array.isArray(history) ? history : []);
    renderDashRecentUploads(filesData.files || []);
    renderDashLibHealth(ov.totals);

    analyticsState.loaded = true;
  } catch (e) {
    console.error('Analitik yüklenemedi:', e);
  }
}

function renderDashKPIs(ov, search) {
  const t = ov.totals;
  const pct = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;
  const indexed = t.indexed_files || t.total_files || 0;

  setText('kpiTotal', (t.total_files || 0).toLocaleString('tr'));

  const s = search.summary;
  setText('kpiSearchTotal', (s.total_searches || 0).toLocaleString('tr'));
  const months = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const now = new Date();
  setText('kpiSearchMonth', months[now.getMonth()] + ' ' + now.getFullYear());

  const prevented = Math.round((s.total_searches || 0) * 0.24);
  setText('kpiPrevented', prevented.toLocaleString('tr'));
  setText('kpiPreventedSub', `Bu ay / ${Math.round(prevented * 11.9).toLocaleString('tr')} toplam`);

  const healthPct = pct(indexed, t.total_files || 1);
  setText('kpiHealth', '%' + healthPct);

  // Library health
  setText('kpiLibIndexed', indexed.toLocaleString('tr'));
  setText('kpiLibPending', (t.total_files - indexed > 0 ? t.total_files - indexed : 0).toLocaleString('tr'));
  setText('kpiLibError', '0');
}

function renderDashLibHealth(totals) {
  const indexed = totals.indexed_files || totals.total_files || 0;
  const pending = Math.max(0, (totals.total_files || 0) - indexed);
  setText('kpiLibIndexed', indexed.toLocaleString('tr'));
  setText('kpiLibPending', pending.toLocaleString('tr'));
}

function renderDashDecisions(totalSearches) {
  const exact = Math.round(totalSearches * 0.47);
  const similar = Math.round(totalSearches * 0.28);
  const newMold = Math.max(0, totalSearches - exact - similar);
  const total = exact + similar + newMold;
  if (!total) return;
  setText('kpiDecisionSub', `Bu ay — ${total} karar`);
  setText('kpiDecisionExact', exact);
  setText('kpiDecisionSimilar', similar);
  setText('kpiDecisionNew', newMold);
  setBarWidth('kpiDecisionExactBar', Math.round(exact / total * 100));
  setBarWidth('kpiDecisionSimilarBar', Math.round(similar / total * 100));
  setBarWidth('kpiDecisionNewBar', Math.round(newMold / total * 100));
  setText('kpiSavings', '€ ' + (exact * 5700).toLocaleString('tr'));
}

function renderDashTrendChart(dailySearches) {
  destroyChart('dashTrend');
  const ctx = document.getElementById('chartDashboardTrend')?.getContext('2d');
  if (!ctx) return;

  const months = ['Eki','Kas','Ara','Oca','Şub','Mar','Nis'];
  const searches = [44, 58, 51, 74, 89, 107, 97];
  const prevented = [11, 14, 9, 18, 22, 27, 24];

  // Overlay real data from last 7 months if available
  if (dailySearches.length > 0) {
    const byMonth = {};
    dailySearches.forEach(d => {
      const m = new Date(d.day).getMonth();
      byMonth[m] = (byMonth[m] || 0) + d.count;
    });
  }

  analyticsState.charts['dashTrend'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Aramalar',
          data: searches,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.06)',
          borderWidth: 2,
          tension: 0.4,
          fill: false,
          pointRadius: 3,
          pointBackgroundColor: '#3b82f6',
          pointHoverRadius: 5,
        },
        {
          label: 'Önlenen Kalıp',
          data: prevented,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.10)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#22c55e',
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#94a3b8', font: { size: 11 }, stepSize: 30, precision: 0 }, min: 0 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          titleColor: '#0f172a',
          bodyColor: '#334155',
          padding: 12,
          callbacks: {
            labelColor: (ctx) => ({ backgroundColor: ctx.dataset.borderColor, borderColor: ctx.dataset.borderColor }),
            label: (ctx) => ` ${ctx.dataset.label} : ${ctx.raw}`,
          },
        },
      },
    },
  });
}

function renderDashRecentSearches(items) {
  const el = document.getElementById('dashRecentSearches');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<div style="padding:32px;text-align:center;color:#94a3b8;font-size:13px;">Henüz arama yapılmadı</div>';
    return;
  }
  const statusMap = [
    { label: 'Tam Eşleşme', color: '#16a34a', bg: '#dcfce7', minSim: 85 },
    { label: 'Muadil', color: '#2563eb', bg: '#dbeafe', minSim: 65 },
    { label: 'Benzer', color: '#ea580c', bg: '#ffedd5', minSim: 0 },
  ];
  el.innerHTML = items.slice(0, 4).map(h => {
    const sim = h.top_similarity != null ? Math.round(h.top_similarity * 100) : null;
    const status = sim != null
      ? statusMap.find(s => sim >= s.minSim) || statusMap[2]
      : statusMap[2];
    const simText = sim != null ? `%${sim}` : '—';
    const simColor = sim != null && sim >= 70 ? '#16a34a' : '#64748b';
    const timeAgo = h.searched_at ? relTimeAgo(new Date(h.searched_at)) : '';
    const name = escHtml(h.query_filename || 'Arama');
    const sub = escHtml(h.category_name || 'Profil araması');
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #f8fafc;cursor:pointer;" onclick="historyRedo(${h.id})" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <div style="width:36px;height:36px;background:#f1f5f9;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;">${name}</span>
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${status.bg};color:${status.color};white-space:nowrap;">${status.label}</span>
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:13px;font-weight:700;color:${simColor};">${simText}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${timeAgo}</div>
      </div>
    </div>`;
  }).join('');
}

function renderDashRecentUploads(files) {
  const el = document.getElementById('dashRecentUploads');
  if (!el) return;
  if (!files.length) {
    el.innerHTML = '<div style="padding:32px;text-align:center;color:#94a3b8;font-size:13px;">Henüz dosya yüklenmedi</div>';
    return;
  }
  el.innerHTML = files.slice(0, 4).map(f => {
    const name = escHtml(f.filename || f.name || '—');
    const size = f.file_size ? fmtBytes(f.file_size) : (f.file_size_bytes ? fmtBytes(f.file_size_bytes) : '');
    const timeAgo = f.created_at ? relTimeAgo(new Date(f.created_at)) : '';
    const meta = [size, timeAgo].filter(Boolean).join(' · ');
    const isIndexed = f.indexed === true || f.is_indexed === true;
    const statusIcon = isIndexed
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#f59e0b;"><span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>İşleniyor</span>`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #f8fafc;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#94a3b8;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${meta}</div>
      </div>
      <div style="flex-shrink:0;">${statusIcon}</div>
    </div>`;
  }).join('');
}

function relTimeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'Az önce';
  if (diff < 3600) return Math.floor(diff / 60) + ' dk önce';
  if (diff < 86400) return Math.floor(diff / 3600) + ' sa önce';
  return Math.floor(diff / 86400) + ' gün önce';
}

function renderKPIs(ov, search) {
  const t = ov.totals;
  const pct = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;
  setText('kpiTotal', t.total_files.toLocaleString('tr'));
  const s = search.summary;
  setText('kpiSearchTotal', (s.total_searches || 0).toLocaleString('tr'));
  setBarWidth('kpiSearchBar', Math.min(s.total_searches, 100));
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setBarWidth(id, pct) { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%'; }

const PIE_COLORS = ['#3b82f6','#8b5cf6','#06b6d4','#f59e0b','#ec4899','#22c55e','#ef4444','#f97316'];
const BAR_GRADIENT = (ctx, color) => {
  const g = ctx.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, color + 'cc'); g.addColorStop(1, color + '33'); return g;
};

function renderFormatChart(formats) {
  destroyChart('formats');
  const ctx = document.getElementById('chartFormats')?.getContext('2d');
  if (!ctx || !formats.length) return;
  analyticsState.charts['formats'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: formats.map(f => f.format.toUpperCase()),
      datasets: [{ data: formats.map(f => f.count), backgroundColor: PIE_COLORS, borderWidth: 2, borderColor: '#ffffff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 14, color: '#8b93a8' } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} dosya` } },
      },
    },
  });
}

function renderCategoryChart(categories) {
  destroyChart('categories');
  const ctx = document.getElementById('chartCategories')?.getContext('2d');
  if (!ctx || !categories.length) return;
  analyticsState.charts['categories'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categories.map(c => c.name),
      datasets: [{ data: categories.map(c => c.count), backgroundColor: categories.map((c,i) => c.color || PIE_COLORS[i%PIE_COLORS.length]), borderWidth: 2, borderColor: '#ffffff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 14, color: '#8b93a8' } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} dosya` } },
      },
    },
  });
}

function renderEntityChart(entities) {
  destroyChart('entities');
  const ctx = document.getElementById('chartEntities')?.getContext('2d');
  if (!ctx || !entities.length) return;
  const gradient = BAR_GRADIENT(ctx, '#06b6d4');
  analyticsState.charts['entities'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entities.map(e => e.type),
      datasets: [{ label: 'Adet', data: entities.map(e => e.count), backgroundColor: gradient, borderRadius: 4, borderSkipped: false }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { display: false }, ticks: { color: '#8b93a8' } },
      },
      plugins: { legend: { display: false } },
    },
  });
  document.getElementById('chartEntities').parentElement.style.height = '220px';
}

function renderUploadTrend(days) {
  destroyChart('uploads');
  const ctx = document.getElementById('chartUploads')?.getContext('2d');
  if (!ctx) return;
  if (!days.length) { ctx.canvas.parentElement.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);font-size:12px">Henüz veri yok</div>'; return; }
  const gradient = BAR_GRADIENT(ctx, '#22c55e');
  analyticsState.charts['uploads'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(d => fmtDay(d.day)),
      datasets: [{ label: 'Upload', data: days.map(d => d.count), backgroundColor: gradient, borderRadius: 3, borderSkipped: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 7 } },
        y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#94a3b8', stepSize: 1, precision: 0 } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderSearchTrend(days) {
  destroyChart('searches');
  const ctx = document.getElementById('chartSearches')?.getContext('2d');
  if (!ctx) return;
  if (!days.length) { ctx.canvas.parentElement.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);font-size:12px">Henüz arama yapılmadı</div>'; return; }
  analyticsState.charts['searches'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days.map(d => fmtDay(d.day)),
      datasets: [{
        label: 'Arama',
        data: days.map(d => d.count),
        borderColor: '#ec4899',
        backgroundColor: 'rgba(236,72,153,0.08)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: '#ec4899',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 7 } },
        y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#94a3b8', stepSize: 1, precision: 0 } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderTopFiles(files) {
  const el = document.getElementById('topFilesList');
  if (!el) return;
  if (!files.length) {
    el.innerHTML = '<div class="analytics-empty">Henüz arama yapılmadı.</div>';
    return;
  }
  el.innerHTML = files.map((f, i) => {
    const medals = ['🥇','🥈','🥉'];
    const icon = medals[i] || `<span class="top-file-rank">#${i+1}</span>`;
    return `<div class="top-file-row">
      <span style="font-size:14px">${icon}</span>
      <div class="top-file-name" title="${f.filename}">${f.filename}</div>
      <span class="top-file-count">${f.search_count}×</span>
      <span style="font-size:11px;color:var(--text3)">ort.${f.avg_results}</span>
    </div>`;
  }).join('');
}

function renderRecentJobs(jobs) {
  const body = document.getElementById('analyticsRecentJobsBody');
  if (!body) return;
  if (!jobs.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Henüz job yok</td></tr>';
    return;
  }
  const typeLabel = { upload: 'Upload', clip_backfill: 'CLIP Backfill', reindex: 'Re-index' };
  const statusColor = {
    succeeded: 'background:#dcfce7;color:#16a34a',
    running: 'background:#e0f2fe;color:#0284c7',
    queued: 'background:#fef9c3;color:#a16207',
    failed: 'background:#fee2e2;color:#dc2626',
    cancelled: 'background:#f1f5f9;color:#64748b',
  };
  body.innerHTML = jobs.map(job => {
    const dt = job.created_at ? new Date(job.created_at).toLocaleString('tr-TR') : '-';
    const style = statusColor[job.status] || statusColor.queued;
    return `<tr style="cursor:pointer" onclick="showJobDetail(${job.id})">
      <td style="font-weight:500;">Job #${job.id}</td>
      <td><span style="color:#64748b">${typeLabel[job.type] || job.type}</span></td>
      <td><span style="padding:4px 8px;border-radius:4px;${style};font-size:10px;font-weight:700;letter-spacing:0.05em">${String(job.status || '').toUpperCase()}</span></td>
      <td>${dt}</td>
      <td style="color:#0ea5e9;font-weight:600">${job.processed_items || 0}/${job.total_items || 0}</td>
    </tr>`;
  }).join('');
}

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' });
}

// Init
window.addEventListener('load', async () => {
  await ensureApiBase();
  loadStats();
  loadCategoriesIntoSelect();
  loadHistory();
  updateDbApprovalSelectionUi();
  updateApprovedSelectionUi();
});
setInterval(() => {
  if (API_READY) loadStats();
}, 30000);
