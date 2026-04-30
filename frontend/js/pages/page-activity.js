// ── Activity Log ──────────────────────────────────────────────────────────────
let activityPage = 0;
const ACTIVITY_PER_PAGE = 30;

function activityActionLabel(action) {
  if (action === 'upload') return '<span style="color:var(--blue);font-weight:600">Yukledi</span>';
  if (action === 'draft') return '<span style="color:var(--amber);font-weight:600">Draft</span>';
  if (action === 'approved') return '<span style="color:var(--green);font-weight:600">Onayladi</span>';
  if (action === 'uploaded') return '<span style="color:var(--cyan);font-weight:600">Yuklendi</span>';
  if (action === 'clip_backfill') return '<span style="color:#7c3aed;font-weight:600">CLIP Backfill</span>';
  if (action === 'reindex') return '<span style="color:var(--amber);font-weight:600">Re-index</span>';
  if (action === 'download') return '<span style="color:var(--blue);font-weight:600">Indirdi</span>';
  if (action === 'delete') return '<span style="color:var(--red);font-weight:600">Sildi</span>';
  if (action === 'search') return '<span style="color:var(--green);font-weight:600">Arama</span>';
  return '<span style="font-weight:600">' + (action || '-') + '</span>';
}

async function loadActivityLog() {
  const tbody = document.getElementById('activityTableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="db-empty">Yukleniyor...</td></tr>';
  try {
    const [jobsRes, activityRes] = await Promise.all([
      fetch(API + '/jobs?per_page=' + ACTIVITY_PER_PAGE + '&page=' + (activityPage + 1), { headers: authH() }),
      fetch(API + '/activity?limit=' + ACTIVITY_PER_PAGE + '&offset=' + (activityPage * ACTIVITY_PER_PAGE), { headers: authH() }),
    ]);
    if (jobsRes.status === 401 || activityRes.status === 401) { logout(); return; }
    const jobsData = await jobsRes.json();
    const activityData = await activityRes.json();
    const jobItems = (jobsData.jobs || []).map(job => ({
      kind: 'job',
      created_at: job.updated_at || job.created_at,
      user_email: job.user_email,
      action: job.type,
      filename: `Job #${job.id}`,
      details: `${job.status} · ${job.processed_items || 0}/${job.total_items || 0} · OK ${job.succeeded_items || 0} / Hata ${job.failed_items || 0}`,
      status: job.status,
      job_id: job.id,
    }));
    const logItems = (activityData.items || []).map(item => ({ ...item, kind: 'activity' }));
    const items = jobItems.concat(logItems)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, ACTIVITY_PER_PAGE);
    const total = (jobsData.total || 0) + (activityData.total || 0);

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="db-empty">Henuz log yok</td></tr>';
      document.getElementById('activityPagination').style.display = 'none';
      return;
    }

    tbody.innerHTML = items.map(function(item) {
      var d = item.created_at ? new Date(item.created_at) : null;
      var dateStr = d ? d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'}) : '-';
      return '<tr>' +
        '<td class="td-date">' + dateStr + '</td>' +
        '<td>' + (item.user_email || '-') + '</td>' +
        '<td>' + activityActionLabel(item.action) + '</td>' +
        '<td class="td-filename">' + (item.kind === 'job' ? '<button class="pg-btn" onclick="showJobDetail(' + item.job_id + ')">' + item.filename + '</button>' : (item.filename || '-')) + '</td>' +
        '<td style="color:var(--text3);font-size:12px">' + (item.details || '') + '</td>' +
      '</tr>';
    }).join('');

    var totalPages = Math.ceil(total / ACTIVITY_PER_PAGE);
    if (totalPages > 1) {
      document.getElementById('activityPagination').style.display = 'flex';
      document.getElementById('activityPageInfo').textContent = (activityPage + 1) + ' / ' + totalPages + ' (' + total + ' kayit)';
      document.getElementById('activityPrevBtn').disabled = activityPage === 0;
      document.getElementById('activityNextBtn').disabled = activityPage >= totalPages - 1;
    } else {
      document.getElementById('activityPagination').style.display = 'none';
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="db-empty">Yuklenemedi: ' + e.message + '</td></tr>';
  }
}

let _jobModalPollTimer = null;

function closeJobModal() {
  document.getElementById('jobModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (_jobModalPollTimer) { clearInterval(_jobModalPollTimer); _jobModalPollTimer = null; }
}

async function showJobDetail(jobId) {
  const modal = document.getElementById('jobModal');
  const body  = document.getElementById('jobModalBody');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8">Yükleniyor...</div>';
  if (_jobModalPollTimer) { clearInterval(_jobModalPollTimer); _jobModalPollTimer = null; }
  await _renderJobModal(jobId);
  _jobModalPollTimer = setInterval(async () => {
    const jobModalEl = document.getElementById('jobModal');
    if (!jobModalEl || jobModalEl.classList.contains('hidden')) {
      clearInterval(_jobModalPollTimer); _jobModalPollTimer = null; return;
    }
    const r = await fetch(`${API}/jobs/${jobId}`, { headers: authH() }).catch(() => null);
    if (!r || r.status === 401) return;
    const data = await r.json().catch(() => null);
    if (!data) return;
    const job = data.job || {};
    if (['succeeded','failed','cancelled'].includes(job.status)) {
      clearInterval(_jobModalPollTimer); _jobModalPollTimer = null;
    }
    await _renderJobModal(jobId);
  }, 3000);
}

async function _renderJobModal(jobId) {
  const JOB_TYPE_LABEL = { upload:'Upload', clip_backfill:'CLIP Backfill', reindex:'Re-index',
    gen_preview:'Preview Üret', check_file_data:'Dosya Kontrol', duplicate_rescan:'Duplicate Tarama',
    cleanup_payloads:'Payload Temizlik', report_broken:'Bozuk Rapor' };
  const STATUS_STYLE = {
    succeeded:'background:#dcfce7;color:#16a34a', running:'background:#e0f2fe;color:#0284c7',
    queued:'background:#fef9c3;color:#a16207', failed:'background:#fee2e2;color:#dc2626',
    cancelled:'background:#f1f5f9;color:#64748b'
  };
  const body = document.getElementById('jobModalBody');
  try {
    const r = await fetch(`${API}/jobs/${jobId}`, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const data = await parseApiJsonResponse(r, 'Job detayı alınamadı');
    const job = data.job || {};
    const items = data.items || [];
    const titleEl = document.getElementById('jobModalTitle');
    if (titleEl) titleEl.textContent = `Job #${job.id} — ${JOB_TYPE_LABEL[job.type] || job.type}`;
    const progress = job.total_items > 0 ? Math.round((job.processed_items / job.total_items) * 100) : (job.status === 'succeeded' ? 100 : 0);
    const stStyle = STATUS_STYLE[job.status] || STATUS_STYLE.queued;
    const failedItems = items.filter(i => i.status === 'failed' && i.file_id);
    const canCancel = ['queued','running'].includes(job.status);
    const canRetry  = failedItems.length > 0 && ['succeeded','failed'].includes(job.status);
    const itemsHtml = items.map(it => {
      const ist = STATUS_STYLE[it.status] || STATUS_STYLE.queued;
      return `<div class="job-item-row">
        <span class="job-status-badge" style="${ist}">${(it.status||'').toUpperCase()}</span>
        <span class="job-item-name" title="${it.filename||''}">${it.filename || ('Dosya #'+it.file_id) || '-'}</span>
        ${it.message ? `<span class="job-item-msg" title="${it.message}">${it.message}</span>` : ''}
      </div>`;
    }).join('');
    body.innerHTML = `
      <div class="job-stat-grid">
        <div class="job-stat-card"><div class="job-stat-val">${job.total_items||0}</div><div class="job-stat-lbl">Toplam</div></div>
        <div class="job-stat-card"><div class="job-stat-val" style="color:#0ea5e9">${job.processed_items||0}</div><div class="job-stat-lbl">İşlendi</div></div>
        <div class="job-stat-card"><div class="job-stat-val" style="color:#16a34a">${job.succeeded_items||0}</div><div class="job-stat-lbl">Başarılı</div></div>
        <div class="job-stat-card"><div class="job-stat-val" style="color:#dc2626">${job.failed_items||0}</div><div class="job-stat-lbl">Hatalı</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span class="job-status-badge" style="${stStyle}">${(job.status||'').toUpperCase()}</span>
        <span style="font-size:12px;color:#64748b">${progress}% tamamlandı</span>
        ${job.created_at ? `<span style="font-size:11px;color:#94a3b8;margin-left:auto">${new Date(job.created_at).toLocaleString('tr-TR')}</span>` : ''}
      </div>
      <div class="job-modal-progress-wrap">
        <div class="job-modal-progress-bar" style="width:${progress}%"></div>
      </div>
      ${job.error ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;font-size:12px;color:#dc2626;margin-bottom:10px">${job.error}</div>` : ''}
      <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:6px">Dosyalar (${items.length})</div>
      <div class="job-items-list">${itemsHtml || '<div style="padding:20px;text-align:center;color:#94a3b8">Henüz item yok</div>'}</div>
      <div class="job-modal-actions">
        ${canCancel ? `<button onclick="cancelJobFromModal(${job.id})" style="padding:8px 16px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">İptal Et</button>` : ''}
        ${canRetry  ? `<button onclick="retryFailedFromModal(${job.id})" style="padding:8px 16px;background:#dbeafe;color:#1d4ed8;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Başarısızları Tekrar Dene (${failedItems.length})</button>` : ''}
        <button onclick="closeJobModal()" style="margin-left:auto;padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Kapat</button>
      </div>`;
  } catch(e) {
    body.innerHTML = `<div style="padding:20px;color:#dc2626">${e.message}</div>`;
  }
}

async function cancelJobFromModal(jobId) {
  const r = await fetch(`${API}/jobs/${jobId}/cancel`, { method:'POST', headers: authH() });
  if (r.status === 401) { logout(); return; }
  await _renderJobModal(jobId);
}

async function retryFailedFromModal(jobId) {
  const r = await fetch(`${API}/jobs/${jobId}/retry-failed`, { method:'POST', headers: authH() });
  if (r.status === 401) { logout(); return; }
  const data = await r.json().catch(() => ({}));
  closeJobModal();
  if (data.job_id) showJobDetail(data.job_id);
}

async function sendSearchFeedback(resultFileId, score, isRelevant, btnSuffix) {
  const qs = searchState.results?.query_stats || {};
  const queryFileId = qs.file_id || null;
  try {
    await fetch(`${API}/search/feedback`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_file_id: queryFileId, result_file_id: resultFileId, similarity_score: score, is_relevant: isRelevant })
    });
    const btn = document.getElementById(`fb-${btnSuffix}`);
    if (btn) { btn.style.opacity = '0.4'; btn.disabled = true; }
  } catch {}
}

async function runMaintenanceJob(endpoint) {
  try {
    const r = await fetch(`${API}/jobs/${endpoint}`, { method: 'POST', headers: { ...authH(), 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 401) { logout(); return; }
    const data = await r.json();
    if (data.job_id) {
      showJobDetail(data.job_id);
    } else {
      alert('İşlem başlatılamadı: ' + JSON.stringify(data));
    }
  } catch(e) {
    alert('Hata: ' + e.message);
  }
}

function activityChangePage(dir) {
  activityPage += dir;
  if (activityPage < 0) activityPage = 0;
  loadActivityLog();
}

